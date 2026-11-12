import "server-only";
import { db } from "@/lib/db";
import {
  buildReclamationAnalytics,
  type DeliveredProductRow,
  type DeliveredSupplierRow,
  type ReclamationAnalyticsRow,
} from "./reclamation-analytics";

/** Reklamacije – izveštaji i zaglavlje Dnevnika reklamacija čitaju iste pokazatelje. */
export async function loadReclamationAnalytics() {
  const [rows, deliveredBySupplier, deliveredByProduct] = await Promise.all([
    db.$queryRaw<ReclamationAnalyticsRow[]>`
      SELECT
        r.id,
        r.sku,
        r.status::text AS status,
        r.type::text AS type,
        r.resolution::text AS resolution,
        r."createdAt" AS "createdAt",
        r."resolvedAt" AS "resolvedAt",
        COALESCE(NULLIF(BTRIM(oi.name), ''), NULLIF(BTRIM(p.name), ''), r.sku) AS "productName",
        COALESCE(NULLIF(BTRIM(oi."supplierName"), ''), NULLIF(BTRIM(s.name), ''), 'Bez dobavljača') AS supplier
      FROM "Reclamation" r
      LEFT JOIN "OrderItem" oi ON oi.id = r."orderItemId"
      LEFT JOIN "Product" p ON p.id = COALESCE(r."productId", oi."productId")
      LEFT JOIN "Supplier" s ON s.id = p."supplierId"
    `,
    db.$queryRaw<DeliveredSupplierRow[]>`
      SELECT
        COALESCE(NULLIF(BTRIM(oi."supplierName"), ''), NULLIF(BTRIM(s.name), ''), 'Bez dobavljača') AS supplier,
        COALESCE(SUM(oi.qty), 0)::int AS "deliveredItems"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON p.id = oi."productId"
      LEFT JOIN "Supplier" s ON s.id = p."supplierId"
      WHERE o.status = 'ISPORUCENO'
      GROUP BY 1
    `,
    db.$queryRaw<DeliveredProductRow[]>`
      SELECT oi.sku, COALESCE(SUM(oi.qty), 0)::int AS "deliveredItems"
      FROM "OrderItem" oi
      JOIN "Order" o ON o.id = oi."orderId"
      WHERE o.status = 'ISPORUCENO'
      GROUP BY oi.sku
    `,
  ]);
  const analytics = buildReclamationAnalytics(
    rows,
    deliveredBySupplier,
    deliveredByProduct,
  );
  return analytics;
}
