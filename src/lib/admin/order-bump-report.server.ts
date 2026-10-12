import "server-only";
import { Prisma } from "@prisma/client";
import { db, databaseIdentifier } from "@/lib/db";
import type { ReportPeriod } from "./report-period";

export type OrderBumpReportRow = {
  total: number;
  offerId: string | null;
  sourceSku: string | null;
  sku: string | null;
  name: string | null;
  orders: number;
  delivered: number;
  excluded: number;
  units: number;
  revenue: number;
  deliveredRevenue: number;
};

/** Purchase counts come from committed WEB order lines, including guests without analytics consent. */
export function orderBumpReportQuery(period: Pick<ReportPeriod, "start" | "endExclusive">) {
  return Prisma.sql`
    WITH lines AS (
      SELECT oi."orderBumpOfferId" AS offer, oi."orderBumpSourceSku" AS source,
        oi.sku, oi.name, o.id AS "orderId", o.status,
        LEAST(oi."orderBumpQuantity", oi.qty) AS units,
        LEAST(oi."orderBumpQuantity", oi.qty) * oi."unitPriceSale" *
          CASE WHEN o.subtotal > 0 THEN GREATEST(0, 1 - LEAST(o.subtotal,
            COALESCE(o."voucherDiscount", 0) + COALESCE(o."firstPurchaseDiscount", 0) + COALESCE(o."savedCardDiscount", 0)
          ) / o.subtotal) ELSE 0 END AS revenue
      FROM ${databaseIdentifier("OrderItem")} oi JOIN ${databaseIdentifier("Order")} o ON o.id = oi."orderId"
      WHERE o.channel = 'WEB' AND oi."orderBumpOfferId" IS NOT NULL AND oi."orderBumpQuantity" > 0 AND oi.qty > 0
        AND o."createdAt" >= ${period.start} AND o."createdAt" < ${period.endExclusive}
    )
    SELECT GROUPING(offer)::int AS total, offer AS "offerId", source AS "sourceSku", sku, name,
      COUNT(DISTINCT "orderId") FILTER (WHERE status NOT IN ('OTKAZANO', 'VRACENO'))::int AS orders,
      COUNT(DISTINCT "orderId") FILTER (WHERE status = 'ISPORUCENO')::int AS delivered,
      COUNT(DISTINCT "orderId") FILTER (WHERE status IN ('OTKAZANO', 'VRACENO'))::int AS excluded,
      COALESCE(SUM(units) FILTER (WHERE status NOT IN ('OTKAZANO', 'VRACENO')), 0)::int AS units,
      COALESCE(ROUND(SUM(revenue) FILTER (WHERE status NOT IN ('OTKAZANO', 'VRACENO')), 2), 0)::float8 AS revenue,
      COALESCE(ROUND(SUM(revenue) FILTER (WHERE status = 'ISPORUCENO'), 2), 0)::float8 AS "deliveredRevenue"
    FROM lines
    GROUP BY GROUPING SETS ((offer, source, sku, name), ())
    ORDER BY total DESC, orders DESC, name
  `;
}

export async function getOrderBumpReport(period: ReportPeriod) {
  const [rows, engagement] = await Promise.all([
    db.$queryRaw<OrderBumpReportRow[]>(orderBumpReportQuery(period)),
    db.$queryRaw<Array<{ viewers: number; adders: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT "anonymousId") FILTER (WHERE type = 'ORDER_BUMP')::int AS viewers,
        COUNT(DISTINCT "anonymousId") FILTER (WHERE type = 'ADD_TO_CART')::int AS adders
      FROM ${databaseIdentifier("AnalyticsEvent")}
      WHERE metadata->>'surface' = 'cart_order_bump'
        AND "occurredAt" >= ${period.start} AND "occurredAt" < ${period.endExclusive}
        AND type IN ('ORDER_BUMP', 'ADD_TO_CART')
    `),
  ]);
  return { total: rows.find(row => row.total === 1)!, rows: rows.filter(row => row.total === 0), engagement: engagement[0] };
}
