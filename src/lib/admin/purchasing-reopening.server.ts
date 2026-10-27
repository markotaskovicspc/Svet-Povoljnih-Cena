import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory";
import { getActivePricingRules } from "@/lib/pricing/rules";
import { allocateActualInboundCosts, assertInboundCostVolumeReady, reconcileInboundGoods, validateInboundInvoiceTotals } from "@/lib/admin/inbound-invoice";
import { isPackQuantityValid } from "@/lib/admin/purchase-order";
import { recomputeIncomingStockForPurchaseOrders } from "@/lib/admin/incoming-stock.server";
import { purchasingCorrectionBalance, readPurchasingReopening, withPurchasingReopening, type PurchasingReopening } from "./purchasing-reopening";

export async function lockPurchasingOrder(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "PurchaseOrder" WHERE id = ${id} FOR UPDATE`;
}

export async function assertPurchasingOrderEditable(tx: Prisma.TransactionClient, id: string) {
  await lockPurchasingOrder(tx, id);
  const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });
  if (order.lockedAt || order.status === "CANCELLED") throw new Error("Porudžbenica je zaključana za izmene.");
  return order;
}

function jsonSnapshot(value: unknown) {
  return value == null ? Prisma.DbNull : value as Prisma.InputJsonValue;
}

/** Reopen both linked documents, keeping the physical receipt on hand. */
export async function reopenPurchasingDocument(input: { kind: "invoice" | "purchase-order"; id: string; lockedAt: string }, actorId: string) {
  // This service is also protected when called outside the page action.
  const { requireAdminAction } = await import("@/lib/admin/guard");
  const admin = await requireAdminAction(["SUPER"], ["/admin/erp/porudzbenice", "/admin/erp/ulazne-fakture"]);
  if (admin.id !== actorId) throw new Error("Nije dozvoljeno ponovno otvaranje u ime drugog korisnika.");
  const invoice = input.kind === "invoice" ? await db.inboundInvoice.findUnique({ where: { id: input.id }, select: { purchaseOrderId: true } }) : null;
  const orderId = input.kind === "purchase-order" ? input.id : invoice?.purchaseOrderId;
  if (!orderId) throw new Error("Prijemnica mora biti povezana sa porudžbenicom.");
  return db.$transaction(async tx => {
    await lockPurchasingOrder(tx, orderId);
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, inboundInvoices: { where: { status: { not: "CANCELLED" } } } } });
    if (order.status === "CANCELLED" || order.archivedAt) throw new Error("Otkazana ili arhivirana porudžbenica ne može ponovo da se otvori.");
    if (order.inboundInvoices.length > 1) throw new Error("Porudžbenica ima više aktivnih prijemnica. Potrebno je prvo uskladiti vezane dokumente.");
    const linked = order.inboundInvoices[0];
    const target = input.kind === "invoice" ? linked : order;
    if (!target || (input.kind === "invoice" && linked.id !== input.id)) throw new Error("Veza prijemnice se promenila. Osvežite stranicu.");
    if (readPurchasingReopening(order.cogsBookingSnapshot)) return { orderId, invoiceId: linked?.id ?? null };
    if (!target.lockedAt || target.lockedAt.toISOString() !== input.lockedAt) throw new Error("Dokument je u međuvremenu promenjen. Osvežite stranicu.");
    if (order.status !== "RECEIVED" && order.cogsBookedAt) throw new Error("Prvo dovršite prijem robe preko prijemnice, zatim ponovo otvorite dokumente.");
    let reopening: PurchasingReopening | null = null;
    if (order.status === "RECEIVED") {
      if (linked && (!linked.lockedAt || linked.status !== "POSTED")) throw new Error("Prijemnica ranijeg prijema nije proknjižena. Prvo uskladite vezane dokumente.");
      const warehouseId = order.receivingWarehouseId ?? linked?.warehouseId;
      if (!warehouseId || (linked?.warehouseId && linked.warehouseId !== warehouseId)) throw new Error("Magacin ranijeg prijema nije jednoznačno utvrđen.");
      if (!order.items.length || order.items.some(item => !item.productId || item.receivedQty !== item.qty)) throw new Error("Stavke ranijeg prijema nisu usklađene. Ponovno otvaranje je zaustavljeno.");
      const products = new Map<string, PurchasingReopening["products"][number]>();
      for (const item of order.items) {
        const current = products.get(item.productId!) ?? { productId: item.productId!, sku: item.sku, qty: 0, costRsd: 0 };
        current.qty += item.receivedQty;
        current.costRsd += Number(item.purchasePrice) * Number(order.exchangeRate) * item.qty * (1 + Number(item.customsRate ?? 0) / 100) + Number(item.freightAllocated ?? 0) + Number(item.additionalCostAllocated ?? 0);
        products.set(current.productId, current);
      }
      reopening = { version: 1, token: randomUUID(), invoiceId: linked?.id ?? null, warehouseId, supplierId: order.supplierId, products: [...products.values()].map(p => ({ ...p, costRsd: Math.round(p.costRsd * 100) / 100 })) };
    }
    await tx.purchaseOrder.update({ where: { id: orderId }, data: { lockedAt: null, ...(reopening ? { receivingWarehouseId: reopening.warehouseId } : {}), cogsBookingSnapshot: jsonSnapshot(withPurchasingReopening(order.cogsBookingSnapshot, reopening)) } });
    if (linked) await tx.inboundInvoice.update({ where: { id: linked.id }, data: { lockedAt: null, ...(reopening ? { warehouseId: reopening.warehouseId } : {}), status: "RECEIVED", cogsStatus: "CALCULATED" } });
    await tx.purchaseOrderStatusEvent.create({ data: { purchaseOrderId: orderId, status: order.status, actorId, note: `Super admin je ponovo otvorio porudžbenicu${linked ? ` i prijemnicu ${linked.number}` : ""} za izmenu. Postojeći robni prijem je sačuvan.` } });
    return { orderId, invoiceId: linked?.id ?? null, reopening };
  });
}

/** Single atomic publication of edited costs, inventory differences and locks. */
export async function postPurchasingCorrection(orderId: string, actorId: string, token: string) {
  const pricingRules = await getActivePricingRules();
  return db.$transaction(async tx => {
    await lockPurchasingOrder(tx, orderId);
    const initial = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { receivingWarehouse: true } });
    const reopening = readPurchasingReopening(initial.cogsBookingSnapshot);
    if (!reopening) {
      if (initial.lockedAt && initial.status === "RECEIVED") return { order: initial, postedLines: 0 };
      throw new Error("Dokument više nije otvoren za ispravku. Osvežite stranicu.");
    }
    if (reopening.token !== token || initial.lockedAt || initial.status !== "RECEIVED") throw new Error("Dokument je u međuvremenu promenjen. Osvežite stranicu.");
    const { recomputePurchaseOrderTotals } = await import("@/lib/admin/po");
    await recomputePurchaseOrderTotals(orderId, tx, pricingRules);
    const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, supplier: true, receivingWarehouse: true, inboundInvoices: { where: { status: { not: "CANCELLED" } } } } });
    if (!order.supplier?.enabled || order.supplier.integrationKey === "RABALUX") throw new Error("Dobavljač nije dostupan za magacinski prijem.");
    if (order.supplierId !== reopening.supplierId || order.receivingWarehouseId !== reopening.warehouseId || !order.receivingWarehouse?.active) throw new Error("Dobavljač i magacin već primljene robe ne mogu da se promene kroz ispravku dokumenta.");
    if (!order.items.length || order.items.some(item => !item.productId || !Number.isInteger(item.qty) || item.qty <= 0 || !isPackQuantityValid(item.qty, item.packQty))) throw new Error("Proverite artikle, količine i pakovanja porudžbenice.");
    assertInboundCostVolumeReady(order.items.map(item => ({ sku: item.sku, qty: item.qty, totalVolumeM3: Number(item.totalVolume ?? 0) })));
    const invoice = order.inboundInvoices[0];
    if (order.inboundInvoices.length !== (reopening.invoiceId ? 1 : 0) || (invoice?.id ?? null) !== reopening.invoiceId) throw new Error("Veza sa prijemnicom se promenila. Knjiženje je zaustavljeno.");
    let adjustments: Map<string, number>;
    if (invoice) {
      if (invoice.lockedAt || !invoice.invoiceDate || invoice.warehouseId !== reopening.warehouseId || invoice.supplierId !== reopening.supplierId) throw new Error("Proverite podatke ponovo otvorene prijemnice.");
      if ([invoice.invoiceValueRsd, invoice.customsValueRsd, invoice.transportValueRsd, invoice.otherRelatedCostsRsd].some(value => value == null)) throw new Error("Sačuvajte vrednosti robe i troškova prijemnice pre ponovnog knjiženja.");
      validateInboundInvoiceTotals({ netValue: Number(invoice.netValue), vatValue: Number(invoice.vatValue), grossValue: Number(invoice.grossValue) });
      const reconciliation = reconcileInboundGoods({ invoiceValue: Number(invoice.value), invoiceValueRsd: Number(invoice.invoiceValueRsd), invoiceCurrency: invoice.currency, orderCurrency: order.currency, lines: order.items.map(item => ({ qty: item.qty, purchasePrice: Number(item.purchasePrice) })) });
      if (reconciliation.error) throw new Error(reconciliation.error);
      const allocations = allocateActualInboundCosts({ costs: { invoiceValueRsd: Number(invoice.invoiceValueRsd), customsValueRsd: Number(invoice.customsValueRsd), transportValueRsd: Number(invoice.transportValueRsd), otherRelatedCostsRsd: Number(invoice.otherRelatedCostsRsd) }, otherCostsBasis: "VOLUME", lines: order.items.map(item => ({ id: item.id, sku: item.sku, qty: item.qty, purchaseValueRsd: Number(item.purchasePrice) * Number(order.exchangeRate) * item.qty, customsRatePct: Number(item.customsRate ?? 0), transportBaselineRsd: Number(item.freightAllocated ?? 0), totalVolumeM3: Number(item.totalVolume ?? 0) })) });
      adjustments = new Map(allocations.map(line => [line.id, line.adjustmentRsd]));
    } else adjustments = new Map(order.items.map(item => [item.id, Number(item.additionalCostAllocated ?? 0)]));
    const desired = new Map<string, { qty: number; costRsd: number; sku: string }>();
    for (const item of order.items) {
      const product = desired.get(item.productId!) ?? { sku: item.sku, qty: 0, costRsd: 0 };
      product.qty += item.qty;
      product.costRsd += Number(item.purchasePrice) * Number(order.exchangeRate) * item.qty * (1 + Number(item.customsRate ?? 0) / 100) + Number(item.freightAllocated ?? 0) + (adjustments.get(item.id) ?? 0);
      desired.set(item.productId!, product);
    }
    const before = new Map(reopening.products.map(p => [p.productId, p]));
    const ids = [...new Set([...before.keys(), ...desired.keys()])].sort();
    // Use the same product locks as checkout/inventory; never remove reserved stock.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "Product" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
    const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, stock: true, cogs: true } });
    if (products.length !== ids.length) throw new Error("Artikal iz ranijeg prijema više nije dostupan.");
    let postedLines = 0;
    for (const product of products) {
      const previous = before.get(product.id);
      const next = desired.get(product.id);
      const balance = purchasingCorrectionBalance({ sku: product.sku, stock: product.stock, cogs: product.cogs == null ? null : Number(product.cogs), previousQty: previous?.qty ?? 0, previousCostRsd: previous?.costRsd ?? 0, qty: next?.qty ?? 0, costRsd: Math.round((next?.costRsd ?? 0) * 100) / 100 });
      if (balance.qtyDelta) {
        await adjustInventory(tx, { idempotencyKey: `purchase-order:${orderId}:correction:${token}:${product.id}`, warehouseId: reopening.warehouseId, productId: product.id, sku: product.sku, qtyDelta: balance.qtyDelta, kind: "ADJUSTMENT", actorId, note: `Ispravka prijema po porudžbenici ${order.number}` });
        postedLines += 1;
      }
      if (balance.cogs != null) await tx.product.update({ where: { id: product.id }, data: { cogs: balance.cogs } });
    }
    for (const item of order.items) await tx.purchaseOrderItem.update({ where: { id: item.id }, data: { receivedQty: item.qty, additionalCostAllocated: adjustments.get(item.id) ?? 0 } });
    const now = new Date();
    if (invoice) await tx.inboundInvoice.update({ where: { id: invoice.id }, data: { lockedAt: now, status: "POSTED", cogsStatus: "LOCKED" } });
    const result = await tx.purchaseOrder.update({ where: { id: orderId }, data: { lockedAt: now, postedAt: now, cogsBookingSnapshot: jsonSnapshot(withPurchasingReopening(order.cogsBookingSnapshot, null)) } });
    await tx.purchaseOrderStatusEvent.create({ data: { purchaseOrderId: orderId, status: "RECEIVED", actorId, note: "Ispravke porudžbenice i povezanog prijema su proknjižene; upisana je samo razlika lagera i COGS-a." } });
    await recomputeIncomingStockForPurchaseOrders(tx, [orderId]);
    return { order: { ...result, receivingWarehouse: order.receivingWarehouse }, postedLines };
  }, { timeout: 60_000 });
}
