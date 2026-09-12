import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ReportPeriod } from "./report-period";
import { AR_EXPERIMENT, AR_EXPERIMENTS } from "@/lib/analytics/product-ar-events";

export type ArReportFilters = { experiment?: keyof typeof AR_EXPERIMENTS; product?: string; campaign?: string; content?: string; source?: string; device?: string; variant?: string };
export type ArReportRow = {
  total: number; productId: string | null; name: string | null; sku: string | null; variant: string | null; device: string | null; campaign: string | null; content: string | null; source: string | null;
  visitors: number; photoExposed: number; arExposed: number; opened: number; used: number; clicked: number; attempted: number; attempts: number; qrShown: number; qrLanded: number; failures: number;
  carts: number; buyers: number; engagedCarts: number; engagedBuyers: number;
};

/** Cohorts are unique browsers/products, assigned to their first context in the selected period. */
export async function getProductArReport(period: ReportPeriod, filters: ArReportFilters = {}) {
  return db.$queryRaw<ArReportRow[]>(Prisma.sql`
    WITH events AS MATERIALIZED (
      SELECT a.*, a.metadata->>'event' AS stage, a.metadata->>'surface' AS surface
      FROM "AnalyticsEvent" a
      WHERE a.type = 'PRODUCT_AR' AND a.metadata->>'experiment' = ${filters.experiment ?? AR_EXPERIMENT}
        AND a."occurredAt" >= ${period.start} AND a."occurredAt" < ${period.endExclusive}
        AND a."productId" IS NOT NULL
    ), context AS (
      SELECT DISTINCT ON ("anonymousId", "productId") "anonymousId", "productId", metadata
      FROM events ORDER BY "anonymousId", "productId", "occurredAt", id
    ), cohort AS (
      SELECT e."anonymousId", e."productId", p.name, p.sku, c.metadata->>'variant' AS variant,
        c.metadata->>'device' AS device, c.metadata->>'source' AS source, c.metadata->>'campaign' AS campaign, c.metadata->>'content' AS content,
        bool_or(e.stage = 'controls_viewed' AND e.surface = 'photo') AS photo_exposed,
        bool_or(e.stage = 'controls_viewed' AND e.surface = 'ar_cta') AS ar_exposed,
        bool_or(e.stage = 'model_opened') AS opened, bool_or(e.stage = 'model_used') AS used,
        bool_or(e.stage = 'ar_clicked') AS clicked, bool_or(e.stage = 'ar_attempted') AS attempted,
        count(*) FILTER (WHERE e.stage = 'ar_attempted')::int AS attempts,
        bool_or(e.stage = 'ar_qr_opened') AS qr_shown, bool_or(e.stage = 'ar_qr_landed') AS qr_landed,
        bool_or(e.stage IN ('ar_failed', 'model_failed')) AS failed,
        min(e."occurredAt") FILTER (WHERE e.stage = 'controls_viewed' AND e.surface = 'ar_cta') AS exposed_at,
        min(e."occurredAt") FILTER (WHERE e.stage IN ('model_used', 'ar_attempted')) AS engaged_at
      FROM events e JOIN context c USING ("anonymousId", "productId") JOIN "Product" p ON p.id = e."productId"
      WHERE (${filters.product || ""} = '' OR p.id = ${filters.product || ""})
        AND (${filters.campaign || ""} = '' OR c.metadata->>'campaign' = ${filters.campaign || ""})
        AND (${filters.content || ""} = '' OR c.metadata->>'content' = ${filters.content || ""})
        AND (${filters.source || ""} = '' OR c.metadata->>'source' = ${filters.source || ""})
        AND (${filters.device || ""} = '' OR c.metadata->>'device' = ${filters.device || ""})
        AND (${filters.variant || ""} = '' OR c.metadata->>'variant' = ${filters.variant || ""})
      GROUP BY e."anonymousId", e."productId", p.name, p.sku, c.metadata
    ), measured AS (
      SELECT c.*, conversion.* FROM cohort c
      CROSS JOIN LATERAL (
        SELECT
          EXISTS(SELECT 1 FROM "AnalyticsEvent" a WHERE a.type = 'ADD_TO_CART' AND a."anonymousId" = c."anonymousId" AND a."productId" = c."productId" AND a."occurredAt" >= c.exposed_at AND a."occurredAt" < c.exposed_at + interval '30 days') AS cart,
          EXISTS(SELECT 1 FROM "AnalyticsEvent" a WHERE a.type = 'ADD_TO_CART' AND a."anonymousId" = c."anonymousId" AND a."productId" = c."productId" AND a."occurredAt" >= c.engaged_at AND a."occurredAt" < c.engaged_at + interval '30 days') AS engaged_cart,
          EXISTS(SELECT 1 FROM "AnalyticsEvent" a JOIN "OrderItem" oi ON oi."orderId" = a."orderId" AND oi."productId" = c."productId"
            WHERE a.type = 'CHECKOUT_COMPLETED' AND a."anonymousId" = c."anonymousId" AND a."occurredAt" >= c.exposed_at AND a."occurredAt" < c.exposed_at + interval '30 days') AS buyer,
          EXISTS(SELECT 1 FROM "AnalyticsEvent" a JOIN "OrderItem" oi ON oi."orderId" = a."orderId" AND oi."productId" = c."productId"
            WHERE a.type = 'CHECKOUT_COMPLETED' AND a."anonymousId" = c."anonymousId" AND a."occurredAt" >= c.engaged_at AND a."occurredAt" < c.engaged_at + interval '30 days') AS engaged_buyer
      ) conversion
    )
    SELECT GROUPING("productId")::int AS total, "productId", name, sku, variant, device, campaign, content, source,
      count(DISTINCT "anonymousId")::int AS visitors,
      count(DISTINCT "anonymousId") FILTER (WHERE photo_exposed)::int AS "photoExposed",
      count(DISTINCT "anonymousId") FILTER (WHERE ar_exposed)::int AS "arExposed",
      count(DISTINCT "anonymousId") FILTER (WHERE opened)::int AS opened,
      count(DISTINCT "anonymousId") FILTER (WHERE used)::int AS used,
      count(DISTINCT "anonymousId") FILTER (WHERE clicked)::int AS clicked,
      count(DISTINCT "anonymousId") FILTER (WHERE attempted)::int AS attempted,
      coalesce(sum(attempts), 0)::int AS attempts,
      count(DISTINCT "anonymousId") FILTER (WHERE qr_shown)::int AS "qrShown",
      count(DISTINCT "anonymousId") FILTER (WHERE qr_landed)::int AS "qrLanded",
      count(DISTINCT "anonymousId") FILTER (WHERE failed)::int AS failures,
      count(DISTINCT "anonymousId") FILTER (WHERE cart)::int AS carts,
      count(DISTINCT "anonymousId") FILTER (WHERE buyer)::int AS buyers,
      count(DISTINCT "anonymousId") FILTER (WHERE engaged_cart)::int AS "engagedCarts",
      count(DISTINCT "anonymousId") FILTER (WHERE engaged_buyer)::int AS "engagedBuyers"
    FROM measured
    GROUP BY GROUPING SETS (("productId", name, sku, variant, device, campaign, content, source), ())
    ORDER BY total DESC, visitors DESC, name, variant
  `);
}

/** Daily action totals include all consent states, without visitor-level records. */
export async function getProductArCounts(period: ReportPeriod, product = "") {
  const [totals] = await db.$queryRaw<Array<{ opened: number; clicked: number; qrLanded: number }>>(Prisma.sql`
    SELECT coalesce(sum(c.count) FILTER (WHERE c.event = 'model_opened'), 0)::int AS opened,
      coalesce(sum(c.count) FILTER (WHERE c.event = 'ar_clicked'), 0)::int AS clicked,
      coalesce(sum(c.count) FILTER (WHERE c.event = 'ar_qr_landed'), 0)::int AS "qrLanded"
    FROM "ProductArDailyCount" c
    LEFT JOIN "Product" p ON p.slug = c.slug
    WHERE c.day >= ${new Date(period.fromInput + "T00:00:00Z")}::date
      AND c.day <= ${new Date(period.toInput + "T00:00:00Z")}::date
      AND (${product} = '' OR p.id = ${product})
  `);
  return totals;
}
