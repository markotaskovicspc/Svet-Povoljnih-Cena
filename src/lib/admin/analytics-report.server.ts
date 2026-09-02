import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ReportPeriod } from "@/lib/admin/report-period";

export const ANALYTICS_GRANULARITIES = ["day", "week", "month"] as const;
export type AnalyticsGranularity =
  (typeof ANALYTICS_GRANULARITIES)[number];

export function normalizeAnalyticsGranularity(
  value: string | string[] | undefined,
): AnalyticsGranularity {
  const selected = Array.isArray(value) ? value[0] : value;
  return ANALYTICS_GRANULARITIES.includes(selected as AnalyticsGranularity)
    ? (selected as AnalyticsGranularity)
    : "day";
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
) {
  if (granularity === "week") {
    return Prisma.sql`date_trunc('week', ${value} AT TIME ZONE 'Europe/Belgrade')`;
  }
  if (granularity === "month") {
    return Prisma.sql`date_trunc('month', ${value} AT TIME ZONE 'Europe/Belgrade')`;
  }
  return Prisma.sql`date_trunc('day', ${value} AT TIME ZONE 'Europe/Belgrade')`;
}

export async function getPageConversionReport(
  period: ReportPeriod,
  granularity: AnalyticsGranularity,
): Promise<PageConversionReportRow[]> {
  const visitBucket = bucketSql(granularity, Prisma.sql`a."occurredAt"`);
  const purchaseBucket = bucketSql(granularity, Prisma.sql`c."occurredAt"`);
  const rows = await db.$queryRaw<PageConversionDatabaseRow[]>(Prisma.sql`
    WITH page_visits AS (
      SELECT
        to_char(${visitBucket}, 'YYYY-MM-DD') AS bucket,
        COALESCE(NULLIF(a.path, ''), '/') AS path,
        COUNT(*)::int AS page_views,
        COUNT(DISTINCT COALESCE(a."sessionId", a."anonymousId"))::int AS visits
      FROM "AnalyticsEvent" a
      WHERE a.type = 'PAGE_VIEW'
        AND a."occurredAt" >= ${period.start}
        AND a."occurredAt" < ${period.endExclusive}
      GROUP BY ${visitBucket}, COALESCE(NULLIF(a.path, ''), '/')
    ), attributed_orders AS (
      SELECT DISTINCT ON (c."orderId")
        c."orderId",
        to_char(${purchaseBucket}, 'YYYY-MM-DD') AS bucket,
        last_page.path,
        COALESCE(c.value, 0)::double precision AS value
      FROM "AnalyticsEvent" c
      JOIN LATERAL (
        SELECT COALESCE(NULLIF(v.path, ''), '/') AS path
        FROM "AnalyticsEvent" v
        WHERE v.type = 'PAGE_VIEW'
          AND v."anonymousId" = c."anonymousId"
          AND v."occurredAt" <= c."occurredAt"
          AND v."occurredAt" >= c."occurredAt" - interval '30 days'
        ORDER BY v."occurredAt" DESC, v.id DESC
        LIMIT 1
      ) last_page ON true
      WHERE c.type = 'CHECKOUT_COMPLETED'
        AND c."orderId" IS NOT NULL
        AND c."occurredAt" >= ${period.start}
        AND c."occurredAt" < ${period.endExclusive}
      ORDER BY c."orderId", c."occurredAt" ASC
    ), purchases AS (
      SELECT
        bucket,
        path,
        COUNT(*)::int AS purchases,
        COALESCE(SUM(value), 0)::double precision AS purchase_value
      FROM attributed_orders
      GROUP BY bucket, path
    )
    SELECT
      COALESCE(v.bucket, p.bucket) AS bucket,
      COALESCE(v.path, p.path) AS path,
      COALESCE(v.page_views, 0)::int AS page_views,
      COALESCE(v.visits, 0)::int AS visits,
      COALESCE(p.purchases, 0)::int AS purchases,
      COALESCE(p.purchase_value, 0)::double precision AS purchase_value
    FROM page_visits v
    FULL OUTER JOIN purchases p
      ON p.bucket = v.bucket AND p.path = v.path
    ORDER BY bucket DESC, page_views DESC, path ASC
  `);

  return rows.map((row) => ({
    bucket: row.bucket,
    path: row.path,
    pageViews: row.page_views,
    visits: row.visits,
    purchases: row.purchases,
    purchaseValue: row.purchase_value,
    conversionPct:
      row.visits > 0
        ? Math.round((row.purchases / row.visits) * 10_000) / 100
        : 0,
  }));
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
