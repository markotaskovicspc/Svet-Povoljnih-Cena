import { PurchaseOrderStatus, StockMovementKind } from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory, ensureDefaultWarehouse } from "@/lib/inventory";
import { buildPurchaseOrderPdf } from "@/lib/admin/po-pdf";
import { trackedDispatch } from "@/lib/email";

export function allocateFreight(
  freightCost: number,
  lines: Array<{ id: string; purchasePrice: number; qty: number }>,
) {
  const total = lines.reduce((sum, line) => sum + line.purchasePrice * line.qty, 0);
  return new Map(
    lines.map((line) => [
      line.id,
      total > 0
        ? Number(((freightCost * line.purchasePrice * line.qty) / total).toFixed(2))
        : 0,
    ]),
  );
}

/** Mark a purchase order as sent to the supplier (spec §4.1.3). */
export async function sendPurchaseOrder(id: string, actorId: string) {
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: { supplier: true, items: { orderBy: { createdAt: "asc" } } },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (!order.supplier?.email) {
    throw new Error("Dobavljač mora imati kontakt email pre slanja porudžbenice.");
  }
  const pdf = buildPurchaseOrderPdf({
    ...order,
    freightCost: Number(order.freightCost),
    totalPrice: Number(order.totalPrice),
    items: order.items.map((item) => ({
      ...item,
      purchasePrice: Number(item.purchasePrice),
    })),
  });
  const result = await trackedDispatch({
    kind: "purchase_order",
    to: order.supplier.email,
    subject: `Porudžbenica ${order.number}`,
    html: `<p>Poštovani,</p><p>u prilogu je porudžbenica <strong>${escapeHtml(order.number)}</strong>.</p><p>Srdačan pozdrav,<br>Svet povoljnih cena</p>`,
    text: `Poštovani, u prilogu je porudžbenica ${order.number}.`,
    attachments: [
      {
        filename: `porudzbenica-${order.number.replaceAll("/", "-")}.pdf`,
        content: pdf.toString("base64"),
        contentType: "application/pdf",
      },
    ],
    tags: { kind: "purchase_order", purchase_order: order.id },
    metadata: { purchaseOrderId: order.id, supplierId: order.supplier.id },
    idempotencyKey: `purchase-order:${order.id}:send:${order.updatedAt.toISOString()}`,
  });
  if (!result.ok) throw new Error(`Slanje porudžbenice nije uspelo: ${result.error}`);
  await db.$transaction([
    db.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.SENT,
        orderDate: order.orderDate ?? new Date(),
        pdfUrl: `/api/admin/purchase-orders/${order.id}/pdf`,
      },
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

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  const order = await db.purchaseOrder.findUnique({
    where: { id },
    include: { items: { include: { product: { select: { id: true, cogs: true } } } } },
  });
  if (!order) throw new Error("Porudžbenica ne postoji.");
  if (order.status === PurchaseOrderStatus.RECEIVED) {
    return { received: false, postedLines: 0, warehouseName: null };
  }

  let postedLines = 0;
  let warehouseName: string | null = null;
  const received = await db.$transaction(async (tx) => {
    const locked = await tx.purchaseOrder.updateMany({
      where: { id, status: { not: PurchaseOrderStatus.RECEIVED } },
      data: { status: PurchaseOrderStatus.RECEIVED },
    });
    if (locked.count !== 1) return false;
    const warehouse = await ensureDefaultWarehouse(tx);
    warehouseName = warehouse.name;
    const allocations = allocateFreight(
      Number(order.freightCost),
      order.items.map((item) => ({
        id: item.id,
        purchasePrice: Number(item.purchasePrice),
        qty: item.qty,
      })),
    );
    for (const item of order.items) {
      const freightAllocated = allocations.get(item.id) ?? 0;
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: item.qty, freightAllocated },
      });
      if (item.productId && item.qty > 0) {
        const onHand = await tx.warehouseStock.aggregate({
          _sum: { qty: true },
          where: { productId: item.productId },
        });
        const oldQty = onHand._sum.qty ?? 0;
        const newCogs = Number(item.purchasePrice) + freightAllocated / item.qty;
        const oldCogs = item.product?.cogs != null ? Number(item.product.cogs) : newCogs;
        const denominator = oldQty + item.qty;
        const finalCogs =
          denominator > 0 ? (oldQty * oldCogs + item.qty * newCogs) / denominator : newCogs;
        await tx.product.update({
          where: { id: item.productId },
          data: { cogs: Number(finalCogs.toFixed(2)) },
        });
        await adjustInventory(tx, {
          idempotencyKey: `purchase-order:${order.id}:receive:${item.id}`,
          warehouseId: warehouse.id,
          productId: item.productId,
          sku: item.sku,
          qtyDelta: item.qty,
          kind: StockMovementKind.ADJUSTMENT,
          note: `Prijem po porudžbenici ${order.number}`,
          actorId,
        });
        postedLines += 1;
      }
    }
    await tx.purchaseOrderStatusEvent.create({
      data: {
        purchaseOrderId: id,
        status: PurchaseOrderStatus.RECEIVED,
        note: `Prijem proknjižen na magacin ${warehouse.name}; transport ${Number(order.freightCost).toFixed(2)} ${order.currency} raspoređen u COGS`,
        actorId,
      },
    });
    return true;
  });

  return { received, postedLines: received ? postedLines : 0, warehouseName };
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
