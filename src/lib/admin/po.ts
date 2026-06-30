import { PurchaseOrderStatus, StockMovementKind } from "@prisma/client";
import { db } from "@/lib/db";

/** Mark a purchase order as sent to the supplier (spec §4.1.3). */
export async function sendPurchaseOrder(id: string, actorId: string) {
  const order = await db.purchaseOrder.findUnique({ where: { id } });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  await db.$transaction([
    db.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.SENT, orderDate: order.orderDate ?? new Date() },
    }),
    db.purchaseOrderStatusEvent.create({
      data: {
        purchaseOrderId: id,
        status: PurchaseOrderStatus.SENT,
        note: "Poslato dobavljaču",
        actorId,
      },
    }),
  ]);
}

/**
 * Receive a purchase order into stock (spec §4 "Proknjiži" / prijemnica):
 * sets receivedQty, posts WarehouseStock + StockMovement, recomputes
 * weighted-average COGS per line (spec §5.1), and flips status to RECEIVED.
 * Idempotent — a PO already RECEIVED is skipped.
 */
export async function receivePurchaseOrder(
  id: string,
  actorId: string,
): Promise<{ received: boolean; postedLines: number; warehouseName: string | null }> {
  const warehouse =
    (await db.warehouse.findFirst({ where: { isDefault: true } })) ??
    (await db.warehouse.findFirst({ where: { active: true } }));

  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { product: { select: { id: true, cogs: true } } } } },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (order.status === PurchaseOrderStatus.RECEIVED) {
    return { received: false, postedLines: 0, warehouseName: warehouse?.name ?? null };
  }

  let postedLines = 0;
  await db.$transaction(async (tx) => {
    for (const item of order.items) {
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: item.qty },
      });
      if (warehouse && item.productId && item.qty > 0) {
        const onHand = await tx.warehouseStock.aggregate({
          _sum: { qty: true },
          where: { productId: item.productId },
        });
        const oldQty = onHand._sum.qty ?? 0;
        const newCogs = Number(item.purchasePrice);
        const oldCogs = item.product?.cogs != null ? Number(item.product.cogs) : newCogs;
        const denominator = oldQty + item.qty;
        const finalCogs =
          denominator > 0 ? (oldQty * oldCogs + item.qty * newCogs) / denominator : newCogs;
        await tx.product.update({
          where: { id: item.productId },
          data: { cogs: Number(finalCogs.toFixed(2)) },
        });
        await tx.warehouseStock.upsert({
          where: {
            warehouseId_productId: { warehouseId: warehouse.id, productId: item.productId },
          },
          create: { warehouseId: warehouse.id, productId: item.productId, qty: item.qty },
          update: { qty: { increment: item.qty } },
        });
        await tx.stockMovement.create({
          data: {
            warehouseId: warehouse.id,
            productId: item.productId,
            kind: StockMovementKind.ADJUSTMENT,
            sku: item.sku,
            qty: item.qty,
            note: `Prijem po porudžbenici ${order.number}`,
            actorId,
          },
        });
        postedLines += 1;
      }
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.RECEIVED },
    });
    await tx.purchaseOrderStatusEvent.create({
      data: {
        purchaseOrderId: id,
        status: PurchaseOrderStatus.RECEIVED,
        note: warehouse
          ? `Prijem proknjižen na magacin ${warehouse.name}`
          : "Prijem proknjižen (bez magacina — lager nije ažuriran)",
        actorId,
      },
    });
  });

  return { received: true, postedLines, warehouseName: warehouse?.name ?? null };
}

/** Recompute purchase-order header totals from its line items. */
export async function recomputePurchaseOrderTotals(id: string) {
  const items = await db.purchaseOrderItem.findMany({ where: { purchaseOrderId: id } });
  let totalVolume = 0;
  let totalWeight = 0;
  let totalPrice = 0;
  let bmWeighted = 0;
  let bmBase = 0;
  for (const item of items) {
    totalVolume += Number(item.totalVolume ?? 0);
    totalWeight += Number(item.totalWeight ?? 0);
    totalPrice += Number(item.purchasePrice) * item.qty;
    if (item.bmPct != null && item.calcRetailPrice != null) {
      const base = (Number(item.calcRetailPrice) / 1.2) * item.qty;
      bmWeighted += Number(item.bmPct) * base;
      bmBase += base;
    }
  }
  await db.purchaseOrder.update({
    where: { id },
    data: {
      totalVolume: Number(totalVolume.toFixed(3)),
      totalWeight: Number(totalWeight.toFixed(3)),
      totalPrice: Number(totalPrice.toFixed(2)),
      bmPct: bmBase > 0 ? Number((bmWeighted / bmBase).toFixed(2)) : null,
    },
  });
}
