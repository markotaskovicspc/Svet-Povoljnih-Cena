import "server-only";

import { Prisma } from "@prisma/client";
import { adjustInventory } from "@/lib/inventory";
import { releaseOrderSupplierReservations } from "@/lib/rabalux/fulfillment";

export type RestorableOrderItem = {
  id: string;
  productId: string | null;
  sku: string;
  qty: number;
  warehouseReservedQty: number;
  supplierReservedQty: number;
};

export function warehouseRestoreQty(item: RestorableOrderItem) {
  if (item.warehouseReservedQty > 0) return item.warehouseReservedQty;
  // Rows created before allocation tracking was introduced had both fields at
  // zero and reserved their full quantity from the owned warehouse.
  return item.supplierReservedQty === 0 ? item.qty : 0;
}

export async function restoreOrderReservations(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    orderNumber: string;
    items: RestorableOrderItem[];
    reasonKey: string;
    note: string;
    actorId?: string | null;
  },
) {
  let warehouseLines = 0;
  for (const item of input.items) {
    if (!item.productId) continue;
    const quantity = warehouseRestoreQty(item);
    if (quantity === 0) continue;
    await adjustInventory(tx, {
      idempotencyKey: `order:${input.orderId}:${input.reasonKey}:${item.id}`,
      productId: item.productId,
      sku: item.sku,
      qtyDelta: quantity,
      kind: "ADJUSTMENT",
      orderId: input.orderId,
      actorId: input.actorId,
      note: input.note,
    });
    warehouseLines++;
  }
  const supplierCancellationIds = await releaseOrderSupplierReservations(
    tx,
    input.orderId,
    { cancelled: true },
  );
  return { warehouseLines, supplierCancellationIds };
}
