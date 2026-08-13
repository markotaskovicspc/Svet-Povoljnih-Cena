import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type IncomingStockDb = Pick<
  Prisma.TransactionClient,
  "purchaseOrderItem" | "product"
>;

export async function recomputeIncomingStockForProducts(
  client: IncomingStockDb,
  productIds: readonly string[],
) {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (!uniqueIds.length) return;
  const items = await client.purchaseOrderItem.findMany({
    where: {
      productId: { in: uniqueIds },
      purchaseOrder: {
        lockedAt: { not: null },
        status: { notIn: ["RECEIVED", "CANCELLED"] },
        inboundInvoice: {
          is: { status: { in: ["RECEIVED", "POSTED"] } },
        },
      },
    },
    select: { productId: true, qty: true, receivedQty: true },
  });
  const totals = new Map(uniqueIds.map((productId) => [productId, 0]));
  for (const item of items) {
    if (!item.productId) continue;
    totals.set(
      item.productId,
      (totals.get(item.productId) ?? 0) + Math.max(item.qty - item.receivedQty, 0),
    );
  }
  await Promise.all(
    Array.from(totals, ([productId, incomingStock]) =>
      client.product.update({
        where: { id: productId },
        data: { incomingStock },
      }),
    ),
  );
}

export async function recomputeIncomingStockForPurchaseOrders(
  client: IncomingStockDb,
  purchaseOrderIds: readonly string[],
) {
  const ids = Array.from(new Set(purchaseOrderIds.filter(Boolean)));
  if (!ids.length) return;
  const items = await client.purchaseOrderItem.findMany({
    where: { purchaseOrderId: { in: ids }, productId: { not: null } },
    select: { productId: true },
  });
  await recomputeIncomingStockForProducts(
    client,
    items.map((item) => item.productId).filter((id): id is string => Boolean(id)),
  );
}

export async function recomputeAllIncomingStock() {
  const products = await db.product.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  await db.$transaction(async (tx) => {
    await recomputeIncomingStockForProducts(
      tx,
      products.map((product) => product.id),
    );
  });
}
