import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import type { ReportPeriod } from './report-period';
import { calculateProductPerformance, type PerformanceInput } from './product-performance';

export async function getProductPerformance(period: ReportPeriod, now = new Date()) {
  // One database snapshot: fiscal merchandise from WEB only; stock history covers owned warehouses.
  const products = await db.$queryRaw<PerformanceInput[]>(Prisma.sql`
    WITH sales AS (
      SELECT l."productId", to_char(f."issuedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade', 'YYYY-MM-DD') AS day,
        SUM(CASE WHEN f.kind = 'REFUND' THEN -l.qty ELSE l.qty END)::int AS qty,
        SUM((CASE WHEN f.kind = 'REFUND' THEN -1 ELSE 1 END) * GREATEST(0, l."totalGross" - l."serviceGross"))::double precision AS revenue,
        CASE WHEN COUNT(*) FILTER (WHERE l."unitCogs" IS NULL) > 0 THEN NULL
          ELSE SUM((CASE WHEN f.kind = 'REFUND' THEN -1 ELSE 1 END) * l.qty * l."unitCogs")::double precision END AS cogs
      FROM "FiscalDocumentLine" l JOIN "FiscalDocument" f ON f.id = l."fiscalDocumentId"
      JOIN "Order" o ON o.id = f."orderId"
      WHERE o.channel = 'WEB' AND f.status = 'ISSUED' AND f.kind IN ('SALE','REFUND')
        AND l."productId" IS NOT NULL AND f."issuedAt" >= ${period.start}
        AND f."issuedAt" < ${period.endExclusive} AND f."issuedAt" <= ${now}
      GROUP BY l."productId", day
    ), movements AS (
      SELECT m."productId", json_agg(json_build_object('at', m."createdAt" AT TIME ZONE 'UTC', 'qty', m.qty, 'balance', m."balanceAfterTotal") ORDER BY m."createdAt", m.id) AS points
      FROM "StockMovement" m WHERE m."createdAt" >= ${period.start} AND m."createdAt" < ${period.endExclusive} AND m."createdAt" <= ${now}
      GROUP BY m."productId"
    )
    SELECT p.id, p.sku, p.name, p.stock, p.cogs::double precision AS "unitCogs",
      (SELECT m."balanceAfterTotal" FROM "StockMovement" m WHERE m."productId" = p.id AND m."createdAt" < ${period.start} ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1) AS baseline,
      (SELECT m."balanceAfterTotal" FROM "StockMovement" m WHERE m."productId" = p.id AND m."createdAt" <= ${now} ORDER BY m."createdAt" DESC, m.id DESC LIMIT 1) AS "latestBalance",
      COALESCE(m.points, '[]'::json) AS movements,
      COALESCE((SELECT json_agg(json_build_object('day', s.day, 'qty', s.qty, 'revenue', s.revenue, 'cogs', s.cogs)) FROM sales s WHERE s."productId" = p.id), '[]'::json) AS sales
    FROM "Product" p LEFT JOIN movements m ON m."productId" = p.id
    WHERE p.stock <> 0 OR EXISTS (SELECT 1 FROM "StockMovement" sm WHERE sm."productId" = p.id)
      OR EXISTS (SELECT 1 FROM sales s WHERE s."productId" = p.id)
    ORDER BY p.sku
  `);
  return products.map(product => calculateProductPerformance(product, period, now));
}
