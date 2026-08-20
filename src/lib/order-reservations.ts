import "server-only";

import { Prisma } from "@prisma/client";
import { adjustInventory } from "@/lib/inventory";
import { releaseOrderSupplierReservations } from "@/lib/rabalux/fulfillment";
import { syncProductChannelAvailability } from "@/lib/channel-availability.server";

export type RestorableOrderItem = {
  id: string;
  productId: string | null;
  sku: string;
  qty: number;
  warehouseReservedQty: number;
  warehouseDispatchedQty: number;
  supplierReservedQty: number;
};

export function warehouseRestoreQty(
  item: RestorableOrderItem,
  reservationWasDebited: boolean,
) {
  // New-model reservations never reduced physical stock, so cancellation only
  // clears the reservation. A negative net item ledger balance identifies a
  // legacy reservation whose early debit still needs to be restored.
  if (!reservationWasDebited) return 0;
  if (item.warehouseReservedQty > 0) {
    return Math.max(
      item.warehouseReservedQty - item.warehouseDispatchedQty,
      0,
    );
  }
  if (item.warehouseDispatchedQty > 0) {
    return Math.max(
      item.qty - item.warehouseDispatchedQty - item.supplierReservedQty,
      0,
    );
  }
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
  const reservationLedger = await tx.stockMovement.findMany({
    where: { orderItemId: { in: input.items.map((item) => item.id) } },
    select: { orderItemId: true, qty: true },
  });
  const reservationLedgerByItem = reservationLedger.reduce((totals, movement) => {
    if (movement.orderItemId) {
      totals.set(
        movement.orderItemId,
        (totals.get(movement.orderItemId) ?? 0) + movement.qty,
      );
    }
    return totals;
  }, new Map<string, number>());
  let warehouseLines = 0;
  for (const item of input.items) {
    if (!item.productId) continue;
    const quantity = warehouseRestoreQty(
      item,
      (reservationLedgerByItem.get(item.id) ?? 0) < 0,
    );
    if (quantity > 0) {
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
    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        warehouseReservedQty: 0,
      },
    });
    await syncProductChannelAvailability(tx, item.productId);
  }
  const supplierCancellationIds = await releaseOrderSupplierReservations(
    tx,
    input.orderId,
    { cancelled: true },
  );
  return { warehouseLines, supplierCancellationIds };
}
