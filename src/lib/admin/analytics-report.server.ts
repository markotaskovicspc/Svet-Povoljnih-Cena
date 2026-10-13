import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { REPORT_TIME_ZONE, type ReportPeriod } from "@/lib/admin/report-period";

export type DailyVisitsReportRow = {
  day: string; visits: number; pageViews: number; orderValue: number;
  webOrders: number; ananasOrders: number; ananasOrderValue: number;
  totalOrders: number; totalOrderValue: number; convertedVisits: number;
  conversionPct: number | null;
};

/** Site conversion counts converted tracked sessions; marketplace orders never enter its denominator. */
export async function getDailyVisitsReport(period: ReportPeriod): Promise<DailyVisitsReportRow[]> {
  const rows = await db.$queryRaw<Omit<DailyVisitsReportRow, "conversionPct">[]>(Prisma.sql`
    WITH days AS (
      SELECT generate_series(${period.fromInput}::date::timestamp, ${period.toInput}::date::timestamp, interval '1 day') AS day
    ), orders AS (
      SELECT o.id, o."createdAt", o.channel::text AS channel, o.total
      FROM "Order" o WHERE o.status NOT IN ('OTKAZANO', 'VRACENO')
        AND o.channel IN ('WEB', 'ANANAS')
        AND NOT (o.channel = 'ANANAS' AND EXISTS (SELECT 1 FROM "AnanasOrder" a WHERE a.id = COALESCE(o."externalOrderNo", o.number)))
      UNION ALL
      SELECT a.id, a."createdAt", 'ANANAS', a.total FROM "AnanasOrder" a WHERE a.status <> 'Otkazano'
    )
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day, visits.visits, visits."pageViews",
      totals."orderValue", totals."webOrders", totals."ananasOrders", totals."ananasOrderValue",
      totals."totalOrders", totals."totalOrderValue",
      (SELECT COUNT(DISTINCT COALESCE(c."sessionId", c."anonymousId"))::int
        FROM "AnalyticsEvent" c JOIN "Order" o ON o.id = c."orderId"
        WHERE c.type = 'CHECKOUT_COMPLETED' AND o.channel = 'WEB' AND o.status NOT IN ('OTKAZANO', 'VRACENO')
          AND c."occurredAt" >= bounds.start_at AND c."occurredAt" < bounds.end_at
          AND EXISTS (SELECT 1 FROM "AnalyticsEvent" v WHERE v.type = 'PAGE_VIEW'
            AND COALESCE(v."sessionId", v."anonymousId") = COALESCE(c."sessionId", c."anonymousId")
            AND v."occurredAt" >= bounds.start_at AND v."occurredAt" <= c."occurredAt")
      ) AS "convertedVisits"
    FROM days d
    CROSS JOIN LATERAL (SELECT (d.day AT TIME ZONE ${REPORT_TIME_ZONE}) AT TIME ZONE 'UTC' AS start_at,
      ((d.day + interval '1 day') AT TIME ZONE ${REPORT_TIME_ZONE}) AT TIME ZONE 'UTC' AS end_at) bounds
    CROSS JOIN LATERAL (SELECT COUNT(DISTINCT COALESCE(a."sessionId", a."anonymousId"))::int AS visits,
      COUNT(*)::int AS "pageViews" FROM "AnalyticsEvent" a WHERE a.type = 'PAGE_VIEW'
        AND a."occurredAt" >= bounds.start_at AND a."occurredAt" < bounds.end_at) visits
    CROSS JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE channel = 'WEB')::int AS "webOrders",
      COALESCE(SUM(total) FILTER (WHERE channel = 'WEB'), 0)::double precision AS "orderValue",
      COUNT(*) FILTER (WHERE channel = 'ANANAS')::int AS "ananasOrders",
      COALESCE(SUM(total) FILTER (WHERE channel = 'ANANAS'), 0)::double precision AS "ananasOrderValue",
      COUNT(*)::int AS "totalOrders", COALESCE(SUM(total), 0)::double precision AS "totalOrderValue"
      FROM orders WHERE "createdAt" >= bounds.start_at AND "createdAt" < bounds.end_at) totals
    ORDER BY d.day DESC
  `);
  return rows.map(row => ({ ...row, conversionPct: row.visits > 0 ? row.convertedVisits / row.visits * 100 : null }));
}

export const ANALYTICS_GRANULARITIES = ["day", "week", "month", "period"] as const;
export type AnalyticsGranularity =
  (typeof ANALYTICS_GRANULARITIES)[number];

export function normalizeAnalyticsGranularity(
  value: string | string[] | undefined,
): AnalyticsGranularity {
  const selected = Array.isArray(value) ? value[0] : value;
  return ANALYTICS_GRANULARITIES.includes(selected as AnalyticsGranularity)
    ? (selected as AnalyticsGranularity)
    : "period";
}

export type PageConversionReportRow = {
  bucket: string;
  path: string;
  pageViews: number;
  visits: number;
  purchases: number;
  purchaseValue: number;
  conversionPct: number;
};

type PageConversionDatabaseRow = {
  bucket: string;
  path: string;
  page_views: number;
  visits: number;
  purchases: number;
  purchase_value: number;
};

function bucketSql(
  granularity: AnalyticsGranularity,
  value: Prisma.Sql,
  period: ReportPeriod,
) {
  if (granularity === "period") return Prisma.sql`${period.fromInput}::date`;
  // occurredAt is a UTC timestamp WITHOUT time zone, so interpret it as UTC
  // before converting to the Belgrade wall clock used for calendar buckets.
  const local = Prisma.sql`${value} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade'`;
  if (granularity === "week") {
    return Prisma.sql`date_trunc('week', ${local})`;
  }
  if (granularity === "month") {
    return Prisma.sql`date_trunc('month', ${local})`;
  }
  return Prisma.sql`date_trunc('day', ${local})`;
}

/** Collapse product URL query strings and trailing slashes into one product row. */
function analyticsPagePath(alias: "a" | "v") {
  const path = alias === "a" ? Prisma.sql`a.path` : Prisma.sql`v.path`;
  return Prisma.sql`CASE
    WHEN ${path} ~ '^/p/[^/?#]+/?([?#].*)?$'
      THEN rtrim(split_part(split_part(${path}, '?', 1), '#', 1), '/')
    ELSE COALESCE(NULLIF(${path}, ''), '/')
  END`;
}

/** Shared by the table, Excel export, and order drilldown so their totals agree. */
function pagePurchaseOrdersSql(period: ReportPeriod, granularity: AnalyticsGranularity) {
  const purchaseBucket = bucketSql(granularity, Prisma.sql`o."createdAt"`, period);
  return Prisma.sql`
    eligible_orders AS (
      SELECT o.id, o."createdAt", o.total
      FROM "Order" o
      WHERE o.channel = 'WEB' AND o.status NOT IN ('OTKAZANO', 'VRACENO')
        AND o."createdAt" >= ${period.start}
        AND o."createdAt" < ${period.endExclusive}
    ), product_orders AS (
      SELECT o.id AS order_id,
        to_char(${purchaseBucket}, 'YYYY-MM-DD') AS bucket,
        '/p/' || p.slug AS path,
        SUM(oi.qty * oi."unitPriceSale")::double precision AS value,
        SUM(oi.qty)::int AS quantity
      FROM eligible_orders o
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      JOIN "Product" p ON p.id = oi."productId"
      GROUP BY o.id, ${purchaseBucket}, p.slug
    ), attributed_orders AS (
      SELECT DISTINCT ON (o.id) o.id AS order_id,
        to_char(${purchaseBucket}, 'YYYY-MM-DD') AS bucket,
        last_page.path, o.total::double precision AS value, NULL::int AS quantity
      FROM eligible_orders o
      JOIN "AnalyticsEvent" c ON c."orderId" = o.id AND c.type = 'CHECKOUT_COMPLETED'
      JOIN LATERAL (
        SELECT ${analyticsPagePath("v")} AS path
        FROM "AnalyticsEvent" v
        WHERE v.type = 'PAGE_VIEW' AND v."anonymousId" = c."anonymousId"
          AND v."occurredAt" <= c."occurredAt"
          AND v."occurredAt" >= c."occurredAt" - interval '30 days'
        ORDER BY v."occurredAt" DESC, v.id DESC LIMIT 1
      ) last_page ON true
      ORDER BY o.id, c."occurredAt" ASC, c.id ASC
    ), page_orders AS (
      SELECT * FROM product_orders
      UNION ALL
      SELECT * FROM attributed_orders WHERE path !~ '^/p/'
    )
  `;
}

export function pageConversionReportQuery(
  period: ReportPeriod,
  granularity: AnalyticsGranularity,
) {
  const visitBucket = bucketSql(granularity, Prisma.sql`a."occurredAt"`, period);
  const path = analyticsPagePath("a");
  return Prisma.sql`
    WITH ${pagePurchaseOrdersSql(period, granularity)}, page_visits AS (
      SELECT
        to_char(${visitBucket}, 'YYYY-MM-DD') AS bucket,
        ${path} AS path,
        COUNT(*)::int AS page_views,
        COUNT(DISTINCT COALESCE(a."sessionId", a."anonymousId"))::int AS visits
      FROM "AnalyticsEvent" a
      WHERE a.type = 'PAGE_VIEW'
        AND a."occurredAt" >= ${period.start}
        AND a."occurredAt" < ${period.endExclusive}
      GROUP BY ${visitBucket}, ${path}
    ), purchases AS (
      SELECT bucket, path, COUNT(*)::int AS purchases,
        COALESCE(SUM(value), 0)::double precision AS purchase_value
      FROM page_orders GROUP BY bucket, path
    )
    SELECT
      COALESCE(v.bucket, p.bucket) AS bucket,
      COALESCE(v.path, p.path) AS path,
      COALESCE(v.page_views, 0)::int AS page_views,
      COALESCE(v.visits, 0)::int AS visits,
      COALESCE(p.purchases, 0)::int AS purchases,
      COALESCE(p.purchase_value, 0)::double precision AS purchase_value
    FROM page_visits v
    FULL OUTER JOIN purchases p ON p.bucket = v.bucket AND p.path = v.path
    ORDER BY bucket DESC, page_views DESC, path ASC
  `;
}

export async function getPageConversionReport(
  period: ReportPeriod,
  granularity: AnalyticsGranularity,
): Promise<PageConversionReportRow[]> {
  const rows = await db.$queryRaw<PageConversionDatabaseRow[]>(pageConversionReportQuery(period, granularity));
  return rows.map((row) => ({
    bucket: row.bucket,
    path: row.path,
    pageViews: row.page_views,
    visits: row.visits,
    purchases: row.purchases,
    purchaseValue: row.purchase_value,
    conversionPct: row.visits > 0
      ? Math.round((row.purchases / row.visits) * 10_000) / 100
      : 0,
  }));
}

export const PAGE_PURCHASE_ORDERS_SIZE = 50;
export type PagePurchaseOrderRow = {
  id: string;
  number: string;
  status: string;
  createdAt: Date;
  quantity: number | null;
  value: number;
  totalCount: number;
};

export function pagePurchaseOrdersQuery(
  period: ReportPeriod,
  granularity: AnalyticsGranularity,
  path: string,
  bucket: string,
  page = 1,
) {
  return Prisma.sql`
    WITH ${pagePurchaseOrdersSql(period, granularity)}
    SELECT o.id, o.number, o.status, o."createdAt", p.quantity, p.value,
      COUNT(*) OVER()::int AS "totalCount"
    FROM page_orders p JOIN "Order" o ON o.id = p.order_id
    WHERE p.path = ${path} AND p.bucket = ${bucket}
    ORDER BY o."createdAt" DESC, o.id DESC
    LIMIT ${PAGE_PURCHASE_ORDERS_SIZE}
    OFFSET ${(page - 1) * PAGE_PURCHASE_ORDERS_SIZE}
  `;
}

export async function getPagePurchaseOrders(
  period: ReportPeriod,
  granularity: AnalyticsGranularity,
  path: string,
  bucket: string,
  page = 1,
) {
  return db.$queryRaw<PagePurchaseOrderRow[]>(pagePurchaseOrdersQuery(period, granularity, path, bucket, page));
}

export type AnalyticsFunnelSummary = {
  visitors: number;
  purchasers: number;
  purchaseValue: number;
  cartBuyers: number;
  convertedCartBuyers: number;
};

type AnalyticsFunnelDatabaseRow = {
  visitors: number;
  purchasers: number;
  purchase_value: number;
  cart_buyers: number;
  converted_cart_buyers: number;
};

export async function getAnalyticsFunnelSummary(
  period: ReportPeriod,
): Promise<AnalyticsFunnelSummary> {
  const rows = await db.$queryRaw<AnalyticsFunnelDatabaseRow[]>(Prisma.sql`
    WITH visitors AS (
      SELECT DISTINCT a."anonymousId"
      FROM "AnalyticsEvent" a
      WHERE a.type = 'PAGE_VIEW'
        AND a."occurredAt" >= ${period.start}
        AND a."occurredAt" < ${period.endExclusive}
    ), attributed AS (
      SELECT DISTINCT ON (c."orderId")
        c."orderId",
        c."anonymousId",
        COALESCE(c.value, 0)::double precision AS value
      FROM "AnalyticsEvent" c
      WHERE c.type = 'CHECKOUT_COMPLETED'
        AND c."orderId" IS NOT NULL
        AND c."occurredAt" >= ${period.start}
        AND c."occurredAt" < ${period.endExclusive}
        AND EXISTS (
          SELECT 1
          FROM "AnalyticsEvent" v
          WHERE v.type = 'PAGE_VIEW'
            AND v."anonymousId" = c."anonymousId"
            AND v."occurredAt" <= c."occurredAt"
            AND v."occurredAt" >= c."occurredAt" - interval '30 days'
        )
      ORDER BY c."orderId", c."occurredAt" ASC
    ), cart_buyers AS (
      SELECT
        a."anonymousId",
        MIN(a."occurredAt") AS first_cart_at
      FROM "AnalyticsEvent" a
      WHERE a.type = 'ADD_TO_CART'
        AND a."occurredAt" >= ${period.start}
        AND a."occurredAt" < ${period.endExclusive}
      GROUP BY a."anonymousId"
    ), converted_cart_buyers AS (
      SELECT DISTINCT carts."anonymousId"
      FROM cart_buyers carts
      JOIN "AnalyticsEvent" c
        ON c."anonymousId" = carts."anonymousId"
        AND c.type = 'CHECKOUT_COMPLETED'
        AND c."occurredAt" >= carts.first_cart_at
        AND c."occurredAt" <= carts.first_cart_at + interval '30 days'
    )
    SELECT
      (SELECT COUNT(*) FROM visitors)::int AS visitors,
      (SELECT COUNT(DISTINCT "anonymousId") FROM attributed)::int AS purchasers,
      COALESCE((SELECT SUM(value) FROM attributed), 0)::double precision AS purchase_value,
      (SELECT COUNT(*) FROM cart_buyers)::int AS cart_buyers,
      (SELECT COUNT(*) FROM converted_cart_buyers)::int AS converted_cart_buyers
  `);
  const row = rows[0] ?? {
    visitors: 0,
    purchasers: 0,
    purchase_value: 0,
    cart_buyers: 0,
    converted_cart_buyers: 0,
  };
  return {
    visitors: row.visitors,
    purchasers: row.purchasers,
    purchaseValue: row.purchase_value,
    cartBuyers: row.cart_buyers,
    convertedCartBuyers: row.converted_cart_buyers,
  };
}
