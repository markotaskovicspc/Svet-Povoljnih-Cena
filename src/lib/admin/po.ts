import {
  AllocationBasis,
  PurchaseOrderStatus,
  StockMovementKind,
} from "@prisma/client";
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

export function weightedAverageUnitCost(input: {
  existingQty: number;
  existingUnitCost: number;
  incomingQty: number;
  incomingUnitCost: number;
}) {
  if (
    Object.values(input).some(
      (value) => !Number.isFinite(value) || value < 0,
    )
  ) {
    throw new Error("Količine i jedinični troškovi moraju biti nenegativni brojevi.");
  }
  const totalQty = input.existingQty + input.incomingQty;
  if (totalQty === 0) return 0;
  return (
    (input.existingQty * input.existingUnitCost +
      input.incomingQty * input.incomingUnitCost) /
    totalQty
  );
}

type LandedCostLine = {
  id: string;
  purchasePrice: number;
  qty: number;
  totalWeight?: number | null;
  totalVolume?: number | null;
  manualAmount?: number | null;
};

/**
 * Allocates an order-level landed cost and reconciles exactly to cents.
 * AUTO_UTILIZATION uses the greater of each line's normalised weight/volume
 * utilisation, then normalises those weights back to 100%.
 */
export function allocateLandedCost(
  totalCost: number,
  lines: LandedCostLine[],
  basis: AllocationBasis = "AUTO_UTILIZATION",
) {
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    throw new Error("Trošak za raspodelu mora biti nenegativan broj.");
  }
  if (!lines.length) return new Map<string, number>();
  if (basis === "MANUAL") {
    const manualTotal = lines.reduce((sum, line) => sum + (line.manualAmount ?? 0), 0);
    if (Math.abs(manualTotal - totalCost) > 0.009) {
      throw new Error("Ručna raspodela mora tačno da se usaglasi sa ukupnim troškom.");
    }
    return new Map(lines.map((line) => [line.id, Number((line.manualAmount ?? 0).toFixed(2))]));
  }

  const totalValue = lines.reduce(
    (sum, line) => sum + Math.max(line.purchasePrice * line.qty, 0),
    0,
  );
  const totalWeight = lines.reduce(
    (sum, line) => sum + Math.max(line.totalWeight ?? 0, 0),
    0,
  );
  const totalVolume = lines.reduce(
    (sum, line) => sum + Math.max(line.totalVolume ?? 0, 0),
    0,
  );
  const weights = lines.map((line) => {
    const valueShare =
      totalValue > 0 ? Math.max(line.purchasePrice * line.qty, 0) / totalValue : 0;
    const weightShare =
      totalWeight > 0 ? Math.max(line.totalWeight ?? 0, 0) / totalWeight : 0;
    const volumeShare =
      totalVolume > 0 ? Math.max(line.totalVolume ?? 0, 0) / totalVolume : 0;
    if (basis === "VALUE") return valueShare;
    if (basis === "WEIGHT") return weightShare || valueShare;
    if (basis === "VOLUME") return volumeShare || valueShare;
    return Math.max(weightShare, volumeShare) || valueShare;
  });
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const cents = Math.round(totalCost * 100);
  let assignedCents = 0;
  const result = new Map<string, number>();
  lines.forEach((line, index) => {
    const lineCents =
      index === lines.length - 1
        ? cents - assignedCents
        : Math.round(cents * (weightTotal > 0 ? weights[index] / weightTotal : 1 / lines.length));
    assignedCents += lineCents;
    result.set(line.id, lineCents / 100);
  });
  return result;
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
  const invalidPacks = order.items.filter(
    (item) => item.packQty && item.packQty > 0 && item.qty % item.packQty !== 0,
  );
  if (invalidPacks.length) {
    throw new Error(
      `Količina nije deljiva pakovanjem: ${invalidPacks.map((item) => item.sku).join(", ")}.`,
    );
  }
  if (order.transportTypeId) {
    const transport = await db.transportType.findUnique({
      where: { id: order.transportTypeId },
    });
    if (
      transport?.payloadKg &&
      order.totalWeight &&
      Number(order.totalWeight) > Number(transport.payloadKg)
    ) {
      throw new Error(`Ukupna težina prelazi kapacitet transporta ${transport.name}.`);
    }
    if (
      transport?.payloadM3 &&
      order.totalVolume &&
      Number(order.totalVolume) > Number(transport.payloadM3)
    ) {
      throw new Error(`Ukupna zapremina prelazi kapacitet transporta ${transport.name}.`);
    }
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
    subject: `Purchase order ${order.number}`,
    html: `<p>Dear Supplier,</p><p>Please find purchase order <strong>${escapeHtml(order.number)}</strong> attached.</p><p>Please confirm availability and the expected loading date.</p><p>Kind regards,<br>Svet povoljnih cena</p>`,
    text: `Dear Supplier, please find purchase order ${order.number} attached. Please confirm availability and the expected loading date. Kind regards, Svet povoljnih cena.`,
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
        lockedAt: new Date(),
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
    include: {
      items: { include: { product: { select: { id: true, cogs: true } } } },
      receivingWarehouse: true,
    },
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
    const warehouse =
      order.receivingWarehouse?.active
        ? order.receivingWarehouse
        : await ensureDefaultWarehouse(tx);
    warehouseName = warehouse.name;
    const freightRsd = Number(order.freightCost) * Number(order.freightExchangeRate);
    const allocations = allocateLandedCost(
      freightRsd,
      order.items.map((item) => ({
        id: item.id,
        purchasePrice: Number(item.purchasePrice),
        qty: item.qty,
        totalWeight: Number(item.totalWeight ?? 0),
        totalVolume: Number(item.totalVolume ?? 0),
        manualAmount: Number(item.freightAllocated ?? 0),
      })),
      order.allocationBasis,
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
        const purchaseRsd = Number(item.purchasePrice) * Number(order.exchangeRate);
        const customsRsd = purchaseRsd * (Number(item.customsRate ?? 0) / 100);
        const additionalPerUnit = Number(item.additionalCostAllocated ?? 0) / item.qty;
        const newCogs =
          purchaseRsd + customsRsd + freightAllocated / item.qty + additionalPerUnit;
        const oldCogs = item.product?.cogs != null ? Number(item.product.cogs) : newCogs;
        const finalCogs = weightedAverageUnitCost({
          existingQty: oldQty,
          existingUnitCost: oldCogs,
          incomingQty: item.qty,
          incomingUnitCost: newCogs,
        });
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
          kind: StockMovementKind.PURCHASE_RECEIPT,
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
    await tx.purchaseOrder.update({
      where: { id },
      data: { lockedAt: order.lockedAt ?? new Date(), postedAt: new Date() },
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
