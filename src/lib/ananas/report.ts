import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
export async function getAnanasSummary(start: Date, endExclusive: Date) {
  const groups = await db.ananasDocument.groupBy({ by: ["kind"], where: { issuedAt: { gte: start, lt: endExclusive } }, _count: true, _sum: { gross: true, net: true, vat: true } });
  const sale = groups.find(g => g.kind === "SALE"), refund = groups.find(g => g.kind === "REFUND");
  const gross = new Prisma.Decimal(sale?._sum.gross ?? 0), corrections = new Prisma.Decimal(refund?._sum.gross ?? 0);
  return { sales: sale?._count ?? 0, refunds: refund?._count ?? 0, gross: gross.toNumber(), corrections: corrections.toNumber(), afterCorrections: gross.minus(corrections).toNumber(), vat: new Prisma.Decimal(sale?._sum.vat ?? 0).minus(refund?._sum.vat ?? 0).toNumber() };
}

export type AnanasTopProduct = { sku: string; name: string; qty: number; value_rsd: number };
export async function getAnanasTopProducts(start: Date, endExclusive: Date) {
  return db.$queryRaw<AnanasTopProduct[]>(Prisma.sql`
    WITH lines AS (
      SELECT COALESCE(NULLIF(item->>'sku', ''), 'EAN:' || NULLIF(item->>'ean', ''), a.id || '/' || COALESCE(item->>'id', md5(item::text))) AS sku, item->>'name' AS name,
        (item->>'quantity')::numeric AS qty, (item->>'gross')::numeric AS value
      FROM "AnanasOrder" a CROSS JOIN LATERAL jsonb_array_elements(a.items::jsonb) item
      WHERE a.status <> 'Otkazano' AND a."createdAt" >= ${start} AND a."createdAt" < ${endExclusive}
      UNION ALL
      SELECT oi.sku, oi.name, oi.qty, oi.qty * oi."unitPriceSale"
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.channel = 'ANANAS' AND o.status NOT IN ('OTKAZANO', 'VRACENO')
        AND o."createdAt" >= ${start} AND o."createdAt" < ${endExclusive}
        AND NOT EXISTS (SELECT 1 FROM "AnanasOrder" a WHERE a.id = COALESCE(o."externalOrderNo", o.number))
    )
    SELECT COALESCE(sku, '') AS sku, MAX(COALESCE(name, sku, 'Artikal')) AS name,
      SUM(qty)::int AS qty, SUM(value)::double precision AS value_rsd
    FROM lines GROUP BY sku ORDER BY value_rsd DESC, qty DESC, sku ASC LIMIT 10
  `);
}
