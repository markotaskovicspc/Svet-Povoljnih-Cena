import "server-only";

import { PurchaseOrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { recomputeIncomingStockForPurchaseOrders } from "@/lib/admin/incoming-stock.server";

export async function setPurchaseOrdersArchived(
  ids: string[],
  archived: boolean,
  actorId: string,
) {
  if (!ids.length) throw new Error("Izaberite bar jednu porudžbenicu.");

  const uniqueIds = [...new Set(ids)];
  return db.$transaction(async (tx) => {
    if (!archived) {
      const result = await tx.purchaseOrder.updateMany({
        where: { id: { in: uniqueIds }, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      return result.count;
    }

    const existing = await tx.purchaseOrder.findMany({
      where: { id: { in: uniqueIds }, archivedAt: null },
      select: { id: true, status: true },
    });
    if (!existing.length) return 0;

    const archivedAt = new Date();
    const updated = await tx.purchaseOrder.updateManyAndReturn({
      where: { id: { in: existing.map((order) => order.id) }, archivedAt: null },
      data: { archivedAt, status: PurchaseOrderStatus.CANCELLED },
      select: { id: true },
    });
    if (!updated.length) return 0;

    const previousStatus = new Map(existing.map((order) => [order.id, order.status]));
    await tx.purchaseOrderStatusEvent.createMany({
      data: updated.map(({ id }) => ({
        purchaseOrderId: id,
        status: PurchaseOrderStatus.CANCELLED,
        note:
          previousStatus.get(id) === PurchaseOrderStatus.CANCELLED
            ? "Porudžbenica je arhivirana."
            : "Porudžbenica je arhivirana i status je promenjen u Otkazana.",
        actorId,
      })),
    });
    await recomputeIncomingStockForPurchaseOrders(
      tx,
      updated.map(({ id }) => id),
    );
    return updated.length;
  });
}
