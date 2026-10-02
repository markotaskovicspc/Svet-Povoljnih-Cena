import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ReportPeriod } from "@/lib/admin/report-period";
import { EXIT_INTENT_CAMPAIGN, EXIT_INTENT_COOLDOWN_MS } from "@/lib/analytics/exit-intent";

export type ExitIntentReportRow = {
  day: string | null; impressions: number; visitors: number; clicked: number;
  registered: number; loggedIn: number; shopClicked: number; dismissed: number;
  retained: number; buyers: number; orders: number; discountedOrders: number;
  paidOrders: number; orderValue: number;
};

/** Seven-day, last-exposure attribution using server-recorded checkout completions. */
export function exitIntentReportQuery(period: ReportPeriod, now = new Date()) {
  const through = new Date(Math.min(now.getTime(), period.endExclusive.getTime() + EXIT_INTENT_COOLDOWN_MS));
  return Prisma.sql`
    WITH exposures AS (
      SELECT e.id, e."anonymousId", e."occurredAt", e.metadata->>'exposureId' AS exposure,
        to_char(e."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade', 'YYYY-MM-DD') AS day
      FROM "AnalyticsEvent" e
      WHERE e.type = 'EXIT_INTENT' AND e.metadata->>'campaign' = ${EXIT_INTENT_CAMPAIGN}
        AND e.metadata->>'event' = 'impression'
        AND e."occurredAt" >= ${period.start} AND e."occurredAt" < ${through}
    ), cohort AS (
      SELECT * FROM exposures WHERE "occurredAt" < ${period.endExclusive}
    ), actions AS (
      SELECT x.id,
        bool_or(e.metadata->>'event' IN ('register_clicked', 'login_clicked', 'shop_clicked')) AS clicked,
        bool_or(e.metadata->>'event' = 'register_clicked') AS registered,
        bool_or(e.metadata->>'event' = 'login_clicked') AS logged_in,
        bool_or(e.metadata->>'event' = 'shop_clicked') AS shop_clicked,
        bool_or(e.metadata->>'event' = 'dismissed') AS dismissed,
        bool_or(e.metadata->>'event' = 'retained' AND e."occurredAt" >= x."occurredAt" + interval '30 seconds'
          AND e."occurredAt" < x."occurredAt" + interval '30 minutes') AS retained
      FROM cohort x JOIN "AnalyticsEvent" e ON e."anonymousId" = x."anonymousId"
        AND e.type = 'EXIT_INTENT' AND e.metadata->>'campaign' = ${EXIT_INTENT_CAMPAIGN}
        AND e.metadata->>'exposureId' = x.exposure
        AND e."occurredAt" >= ${period.start} AND e."occurredAt" < ${through}
        AND e."occurredAt" < x."occurredAt" + interval '7 days'
      GROUP BY x.id
    ), attributed_orders AS (
      SELECT DISTINCT ON (o.id) o.id AS order_id, x.id AS exposure_id,
        o."firstPurchaseDiscount" > 0 AS discounted,
        (o.status = 'ISPORUCENO' OR EXISTS (
          SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status = 'PAID'
        )) AS paid,
        greatest(0, o.total - o.shipping - o."assemblyTotal") AS value
      FROM "AnalyticsEvent" purchase JOIN "Order" o ON o.id = purchase."orderId"
      JOIN LATERAL (
        SELECT e.id, e."occurredAt" FROM exposures e
        WHERE e."anonymousId" = purchase."anonymousId"
          AND e."occurredAt" <= o."createdAt"
          AND o."createdAt" < e."occurredAt" + interval '7 days'
        ORDER BY e."occurredAt" DESC, e.id DESC LIMIT 1
      ) x ON true
      WHERE purchase.type = 'CHECKOUT_COMPLETED'
        AND purchase."occurredAt" >= ${period.start} AND purchase."occurredAt" < ${through}
        AND o."createdAt" >= ${period.start} AND o."createdAt" < ${through}
        AND o.channel = 'WEB' AND o.status NOT IN ('OTKAZANO', 'VRACENO')
        AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = o.id AND p.status = 'REFUNDED')
      ORDER BY o.id, x."occurredAt" DESC, x.id DESC
    ), orders_by_exposure AS (
      SELECT exposure_id, count(*) AS orders,
        count(*) FILTER (WHERE discounted) AS discounted_orders,
        count(*) FILTER (WHERE paid) AS paid_orders, sum(value) AS value
      FROM attributed_orders GROUP BY exposure_id
    )
    SELECT x.day,
      count(*)::int AS impressions, count(DISTINCT x."anonymousId")::int AS visitors,
      count(DISTINCT x."anonymousId") FILTER (WHERE a.clicked)::int AS clicked,
      count(DISTINCT x."anonymousId") FILTER (WHERE a.registered)::int AS registered,
      count(DISTINCT x."anonymousId") FILTER (WHERE a.logged_in)::int AS "loggedIn",
      count(DISTINCT x."anonymousId") FILTER (WHERE a.shop_clicked)::int AS "shopClicked",
      count(DISTINCT x."anonymousId") FILTER (WHERE a.dismissed)::int AS dismissed,
      count(DISTINCT x."anonymousId") FILTER (WHERE a.retained)::int AS retained,
      count(DISTINCT x."anonymousId") FILTER (WHERE o.orders > 0)::int AS buyers,
      coalesce(sum(o.orders), 0)::int AS orders,
      coalesce(sum(o.discounted_orders), 0)::int AS "discountedOrders",
      coalesce(sum(o.paid_orders), 0)::int AS "paidOrders",
      coalesce(sum(o.value), 0)::double precision AS "orderValue"
    FROM cohort x LEFT JOIN actions a ON a.id = x.id
      LEFT JOIN orders_by_exposure o ON o.exposure_id = x.id
    GROUP BY GROUPING SETS ((x.day), ()) ORDER BY x.day DESC NULLS FIRST
  `;
}

export async function getExitIntentReport(period: ReportPeriod) {
  return db.$queryRaw<ExitIntentReportRow[]>(exitIntentReportQuery(period));
}
