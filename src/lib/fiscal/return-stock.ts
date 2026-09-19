import "server-only";
import type { Prisma } from "@prisma/client";

/** Physical receipt and fiscal refund describe the same returned units. */
export async function returnedStockBalance(tx: Prisma.TransactionClient, orderItemId: string) {
  const [movements, fiscal] = await Promise.all([
    tx.stockMovement.findMany({
      where: { orderItemId, kind: "REFUND_RETURN" },
      select: { qty: true, idempotencyKey: true, warehouseId: true },
    }),
    tx.fiscalDocumentLine.aggregate({
      where: { orderItemId, fiscalDocument: { kind: "SALE", status: "ISSUED" } },
      _sum: { refundedQty: true },
    }),
  ]);
  const received = movements.reduce((sum, row) => sum + (
    row.idempotencyKey?.startsWith("order-return:") ? 1 :
      row.idempotencyKey?.startsWith("reclamation-return:") ? row.qty : 0
  ), 0);
  return {
    received,
    refunded: fiscal._sum.refundedQty ?? 0,
    posted: movements.reduce((sum, row) => sum + row.qty, 0),
    movements,
  };
}
