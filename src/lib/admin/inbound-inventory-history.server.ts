import "server-only";

import { Prisma } from "@prisma/client";
import { databaseIdentifier, db } from "@/lib/db";
import { loadFiscalCogs } from "./fiscal-cogs.server";
import { dateInputInTimeZone, resolveReportPeriod } from "./report-period";

export type ReceiptStockBaseline = {
  productId: string;
  sku: string;
  stock: number;
  cogs: number | null;
  currentCogs: number | null;
  error: string | null;
};

/** Reverse subsequent deltas from today's balance. Stored balanceAfter fields
 * describe posting time and are not historical balances for backdated Ananas
 * documents. Prior receipts use their saved receipt day, not the posting day.
 * Receipts precede other movements on the same calendar day (Belgrade).
 */
export function receiptStockBaselineQuery(productIds: string[], receiptDate: Date, purchaseOrderId: string) {
  const day = dateInputInTimeZone(receiptDate);
  const start = resolveReportPeriod({ range: "custom", from: day, to: day }).start;
  const reverse = Prisma.sql`e."purchaseOrderId" = ${purchaseOrderId}
    OR e."effectiveAt" > ${start}
    OR (e."effectiveAt" = ${start} AND e.kind <> 'PURCHASE_RECEIPT')`;
  return Prisma.sql`
    WITH entries AS (
      SELECT m."productId", m.qty, m.kind,
        CASE WHEN m.kind = 'PURCHASE_RECEIPT' THEN split_part(m."idempotencyKey", ':', 2) END AS "purchaseOrderId",
        COALESCE(
          ((inv."invoiceDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade')::date::timestamp
            AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'UTC',
          m."createdAt"
        ) AS "effectiveAt"
      FROM ${databaseIdentifier("StockMovement")} m
      LEFT JOIN LATERAL (
        SELECT i."invoiceDate" FROM ${databaseIdentifier("InboundInvoice")} i
        WHERE m.kind = 'PURCHASE_RECEIPT'
          AND m."idempotencyKey" LIKE 'purchase-order:%:receive:%'
          AND i."purchaseOrderId" = split_part(m."idempotencyKey", ':', 2)
          AND i.status = 'POSTED' AND i."lockedAt" IS NOT NULL
        ORDER BY i."lockedAt", i.id LIMIT 1
      ) inv ON true
      WHERE m."productId" IN (${Prisma.join(productIds)})
    )
    SELECT p.id AS "productId", p.sku, p.cogs::double precision AS "currentCogs",
      (p.stock - COALESCE(SUM(e.qty) FILTER (WHERE ${reverse}), 0))::int AS stock,
      EXISTS (
        SELECT 1 FROM ${databaseIdentifier("InboundInvoice")} i
        JOIN ${databaseIdentifier("PurchaseOrderItem")} item ON item."purchaseOrderId" = i."purchaseOrderId"
        WHERE item."productId" = p.id AND i.status = 'POSTED' AND i."lockedAt" IS NOT NULL
          AND i."purchaseOrderId" <> ${purchaseOrderId}
          AND (i."invoiceDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade')::date > ${day}::date
      ) AS "hasLaterReceipt"
    FROM ${databaseIdentifier("Product")} p
    LEFT JOIN entries e ON e."productId" = p.id
    WHERE p.id IN (${Prisma.join(productIds)})
    GROUP BY p.id, p.sku, p.stock
  `;
}

type ReceiptHistoryDatabase = Pick<Prisma.TransactionClient,
  "$queryRaw" | "product" | "purchasePrice" | "inboundInvoice" | "ananasDocument">;

export async function loadReceiptStockBaselines(
  productIds: string[], receiptDate: Date, purchaseOrderId: string,
  tx: ReceiptHistoryDatabase = db,
) {
  const ids = [...new Set(productIds)].sort();
  const result = new Map<string, ReceiptStockBaseline>();
  if (!ids.length) return result;
  const rows = await tx.$queryRaw<Array<{ productId: string; sku: string; stock: number; currentCogs: number | null; hasLaterReceipt: boolean }>>(
    receiptStockBaselineQuery(ids, receiptDate, purchaseOrderId),
  );
  const costAt = await loadFiscalCogs(rows.filter(row => row.stock > 0).map(row => row.sku), tx, { excludePurchaseOrderId: purchaseOrderId, receiptBaseline: true });
  const day = dateInputInTimeZone(receiptDate);
  for (const row of rows) {
    const cogs = row.stock <= 0 ? null : costAt(row.sku, receiptDate).unitCogs;
    const error = row.stock < 0
      ? `${row.sku}: Stanje pre prijema ${day} je negativno (${row.stock}). Proverite ranije ulaze i izlaze.`
      : row.stock > 0 && cogs == null
        ? `${row.sku}: Nedostaje nabavna cena postojećih zaliha na datum prijema ${day}.`
        : row.hasLaterReceipt
          ? `${row.sku}: Postoji kasnija proknjižena prijemnica. Potreban je kontrolisan ponovni obračun kasnijeg COGS-a.`
          : null;
    result.set(row.productId, { productId: row.productId, sku: row.sku, stock: row.stock, cogs, currentCogs: row.currentCogs, error });
  }
  return result;
}
