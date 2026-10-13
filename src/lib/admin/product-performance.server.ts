import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import type { ReportPeriod } from './report-period';
import { calculateProductPerformance, type PerformanceInput } from './product-performance';

export function productPerformanceQuery(period: ReportPeriod, now = new Date()) {
  // One database snapshot: fiscal merchandise from WEB only; stock history covers owned warehouses.
  return Prisma.sql`
    WITH sales AS (
      SELECT l."productId", to_char(f."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade', 'YYYY-MM-DD') AS day,
        (CASE WHEN f.kind = 'REFUND' THEN -l.qty ELSE l.qty END)::int AS qty,
        ((CASE WHEN f.kind = 'REFUND' THEN -1 ELSE 1 END) * GREATEST(0, l."totalGross" - l."serviceGross"))::double precision AS revenue,
        ((CASE WHEN f.kind = 'REFUND' THEN -1 ELSE 1 END) * l.qty * COALESCE(l."unitCogs", original."unitCogs"))::double precision AS cogs,
        CASE WHEN f.kind = 'REFUND' THEN original_doc."issuedAt" ELSE f."issuedAt" END AS "costAt"
      FROM "FiscalDocumentLine" l JOIN "FiscalDocument" f ON f.id = l."fiscalDocumentId"
      JOIN "Order" o ON o.id = f."orderId"
      LEFT JOIN "FiscalDocumentLine" original ON original.id = l."originalSaleLineId"
      LEFT JOIN "FiscalDocument" original_doc ON original_doc.id = original."fiscalDocumentId"
      WHERE o.channel = 'WEB' AND f.status = 'ISSUED' AND f.kind IN ('SALE','REFUND')
        AND l."productId" IS NOT NULL AND f."issuedAt" >= ${period.start}
        AND f."issuedAt" < ${period.endExclusive} AND f."issuedAt" <= ${now}
    ), movements AS (
      SELECT m."productId", json_agg(json_build_object('at', m."createdAt" AT TIME ZONE 'UTC', 'qty', m.qty, 'balance', m."balanceAfterTotal") ORDER BY m."createdAt", m.id) AS points
      FROM "StockMovement" m WHERE m."createdAt" >= ${period.start} AND m."createdAt" < ${period.endExclusive} AND m."createdAt" <= ${now}
      GROUP BY m."productId"
    ), booked_costs AS (
      SELECT po.id, po."cogsBookedAt", before->>'productId' AS "productId",
        ROUND(CASE WHEN (before->>'stock')::numeric > 0 AND before->>'cogs' IS NOT NULL
          THEN ((before->>'stock')::numeric * (before->>'cogs')::numeric + incoming.cost)
            / ((before->>'stock')::numeric + incoming.qty)
          ELSE incoming.cost / incoming.qty END, 2)::double precision AS cost
      FROM "PurchaseOrder" po
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN po."cogsBookingSnapshot"->>'version' = '1'
          AND jsonb_typeof(po."cogsBookingSnapshot"->'products') = 'array'
          THEN po."cogsBookingSnapshot"->'products' ELSE '[]'::jsonb END
      ) AS before
      CROSS JOIN LATERAL (
        SELECT SUM(i.qty)::numeric AS qty,
          SUM(i.qty * i."purchasePrice" * po."exchangeRate" * (1 + COALESCE(i."customsRate", 0) / 100)
            + COALESCE(i."freightAllocated", 0) + COALESCE(i."additionalCostAllocated", 0)) AS cost
        FROM "PurchaseOrderItem" i WHERE i."purchaseOrderId" = po.id
          AND i."productId" = before->>'productId' AND i.qty > 0
      ) incoming
      WHERE po."cogsBookedAt" IS NOT NULL AND po."cogsBookedAt" <= ${now}
        AND po."cogsBookedAt" < ${period.endExclusive} AND incoming.qty > 0
        AND jsonb_typeof(before->'stock') = 'number'
        AND (before->>'stock')::numeric >= 0
        AND (before->>'cogs' IS NULL OR jsonb_typeof(before->'cogs') = 'number')
        AND EXISTS (SELECT 1 FROM "InboundInvoice" inv WHERE inv."purchaseOrderId" = po.id AND inv.status = 'POSTED')
    ), receipt_costs AS (
      SELECT m."productId", MIN(m."createdAt") AS at, SUM(m.qty)::double precision AS "incomingQty",
        (array_agg(m."balanceAfterTotal" - m.qty ORDER BY m."createdAt", m.id))[1] AS "beforeStock",
        CASE WHEN COUNT(*) FILTER (WHERE i.id IS NULL) > 0 THEN NULL ELSE
          SUM(m.qty * (i."purchasePrice" * po."exchangeRate" * (1 + COALESCE(i."customsRate", 0) / 100)
            + (COALESCE(i."freightAllocated", 0) + COALESCE(i."additionalCostAllocated", 0)) / NULLIF(i.qty, 0)))::double precision END AS "incomingCost"
      FROM "StockMovement" m
      LEFT JOIN "PurchaseOrderItem" i ON m."idempotencyKey" = 'purchase-order:' || i."purchaseOrderId" || ':receive:' || i.id
      LEFT JOIN "PurchaseOrder" po ON po.id = i."purchaseOrderId"
      WHERE m.kind = 'PURCHASE_RECEIPT' AND m.qty > 0
        AND m."createdAt" <= ${now} AND m."createdAt" < ${period.endExclusive}
        AND NOT EXISTS (SELECT 1 FROM booked_costs b WHERE b."productId" = m."productId"
          AND b."cogsBookedAt" <= m."createdAt"
          AND m."idempotencyKey" LIKE 'purchase-order:' || b.id || ':receive:%')
      GROUP BY m."productId", COALESCE(po.id, m.id)
    ), cost_observations AS (
      SELECT l."productId", f."issuedAt" AS at, MAX(l."unitCogs")::double precision AS cost, 'fiscal' AS source, 2 AS priority,
        NULL::double precision AS "incomingQty", NULL::double precision AS "incomingCost", NULL::int AS "beforeStock"
      FROM "FiscalDocumentLine" l JOIN "FiscalDocument" f ON f.id = l."fiscalDocumentId"
      WHERE f.status = 'ISSUED' AND f.kind = 'SALE' AND l."unitCogs" IS NOT NULL
        AND f."issuedAt" <= ${now} AND f."issuedAt" < ${period.endExclusive}
      GROUP BY l."productId", f."issuedAt" HAVING COUNT(DISTINCT l."unitCogs") = 1
      UNION ALL
      SELECT "productId", "cogsBookedAt", cost, 'booking', 1, NULL, NULL, NULL FROM booked_costs
      UNION ALL
      SELECT "productId", at, NULL::double precision, 'receipt', 0, "incomingQty", "incomingCost", "beforeStock" FROM receipt_costs
    ), cost_points AS (
      SELECT * FROM (
        SELECT c.*, LAG(cost) OVER (PARTITION BY "productId" ORDER BY at, priority) AS previous_cost,
          LAG(source) OVER (PARTITION BY "productId" ORDER BY at, priority) AS previous_source
        FROM cost_observations c
      ) observations WHERE source <> 'fiscal' OR previous_source IS DISTINCT FROM 'fiscal' OR cost IS DISTINCT FROM previous_cost
    )
    SELECT p.id, p.sku, p.name, p.stock,
      (SELECT m."balanceAfterTotal" FROM "StockMovement" m WHERE m."productId" = p.id AND m."createdAt" < ${period.start} ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1) AS baseline,
      (SELECT m."balanceAfterTotal" FROM "StockMovement" m WHERE m."productId" = p.id AND m."createdAt" <= ${now} ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1) AS "latestBalance",
      COALESCE(m.points, '[]'::json) AS movements,
      COALESCE((SELECT json_agg(json_build_object('at', c.at AT TIME ZONE 'UTC', 'unitCost', c.cost, 'source', c.source, 'incomingQty', c."incomingQty", 'incomingCost', c."incomingCost", 'beforeStock', c."beforeStock") ORDER BY c.at, c.priority)
        FROM cost_points c WHERE c."productId" = p.id), '[]'::json) AS "costEvents",
      COALESCE((SELECT json_agg(json_build_object(
        'from', pp."validFrom"::date::timestamp AT TIME ZONE 'Europe/Belgrade',
        'to', CASE WHEN pp."validTo" IS NULL THEN NULL ELSE (pp."validTo"::date + 1)::timestamp AT TIME ZONE 'Europe/Belgrade' END,
        'unitCost', CASE WHEN pp.currency = 'RSD' THEN pp.price::double precision ELSE NULL END
      ) ORDER BY pp."validFrom", pp."createdAt", pp.id) FROM "PurchasePrice" pp
        WHERE (pp."productId" = p.id OR (pp."productId" IS NULL AND lower(pp.sku) = lower(p.sku)))
          AND pp."validFrom"::date <= ${period.toInput}::date
      ), '[]'::json) AS "purchasePrices",
      COALESCE((SELECT json_agg(json_build_object('day', s.day, 'qty', s.qty, 'revenue', s.revenue, 'cogs', s.cogs, 'at', s."costAt" AT TIME ZONE 'UTC')) FROM sales s WHERE s."productId" = p.id), '[]'::json) AS sales
    FROM "Product" p LEFT JOIN movements m ON m."productId" = p.id
    WHERE p.stock <> 0 OR EXISTS (SELECT 1 FROM "StockMovement" sm WHERE sm."productId" = p.id)
      OR EXISTS (SELECT 1 FROM sales s WHERE s."productId" = p.id)
    ORDER BY p.sku
  `;
}

export async function getProductPerformance(period: ReportPeriod, now = new Date()) {
  const products = await db.$queryRaw<PerformanceInput[]>(productPerformanceQuery(period, now));
  return products.map(product => calculateProductPerformance(product, period, now));
}
