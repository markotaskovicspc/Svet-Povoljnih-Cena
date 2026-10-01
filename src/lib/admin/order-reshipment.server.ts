import { readPackedItems } from "@/lib/courier/parcel-contents";
import "server-only";
import { canReshipCourierDelivery } from "./order-reshipment-eligibility";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { adjustInventory } from "@/lib/inventory";
import { lockOrderReturn } from "@/lib/fiscal/return-lock";
import { resolveStoredWarehouseBalance } from "@/lib/reservation-stock";
import { readShipmentAssignment } from "@/lib/courier/shipment-assignment";
import type { SmallParcelProvider } from "@/lib/mygls/config";
import { isCashOnDeliveryPaymentMethod, assertFulfillmentPaymentReady } from "@/lib/payments/fulfillment-readiness";

const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 } as const;

export async function queueOrderReshipment(input: { orderId: string; shipmentId: string; reason: string; actorId: string }) {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 500) throw new Error("Unesite razlog ponovnog slanja (5–500 znakova).");
  return db.$transaction(async (tx) => {
    await lockOrderReturn(tx, input.orderId);
    // Match the courier event lock before changing which delivery controls the order.
    await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${input.shipmentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
    const source = await tx.shipment.findUnique({ where: { id: input.shipmentId }, include: {
      reshipment: { include: { batch: true } },
      order: { include: { items: true, payments: true, paymentRefunds: true } },
    } });
    if (!source || source.orderId !== input.orderId || source.purpose !== "ORDER_DELIVERY") throw new Error("Pošiljka porudžbine nije pronađena.");
    if (source.reshipment) return source.reshipment;
    const order = source.order;
    if (!canReshipCourierDelivery(source)) throw new Error("Ponovno slanje je dostupno za pošiljku koju je kurir već preuzeo, a nije isporučena kupcu.");
    if (order.cancelledAt || order.stockRestoredAt || ["OTKAZANO", "ISPORUCENO"].includes(order.status) || order.paymentRefunds.length) throw new Error("Otkazana, isporučena ili refundirana porudžbina ne može ponovo da se šalje.");
    if (source.provider !== "X_EXPRESS" && source.provider !== "MYGLS") throw new Error("Ponovno slanje podržava X Express i MyGLS.");
    assertFulfillmentPaymentReady({ purpose: "ORDER_DELIVERY", orderNumber: order.number, paymentMethod: order.paymentMethod, paymentStatuses: order.payments.map(p => p.status) });
    const assignment = readShipmentAssignment(source.rawCreateResponse);
    const lines = await reshipmentSourceLines(tx, source);
    const quantities = new Map<string, number>();
    for (const line of lines) {
      const contents = readPackedItems(line.packedItems);
      if (contents.length) {
        for (const item of contents) quantities.set(item.orderItemId, (quantities.get(item.orderItemId) ?? 0) + item.quantity);
      } else {
        quantities.set(line.orderItemId!, Math.max(quantities.get(line.orderItemId!) ?? 0, line.quantity ?? order.items.find(item => item.id === line.orderItemId)?.qty ?? 0));
      }
    }
    const items = [...quantities].map(([id, quantity]) => {
      const item = order.items.find(item => item.id === id);
      if (!item?.productId || !item.warehouseId || quantity < 1 || quantity > item.qty || item.supplierReservedQty > 0) throw new Error("Za ponovno slanje potrebna je jasna količina i magacin svakog artikla.");
      return { item, quantity };
    }).sort((a, b) => a.item.productId!.localeCompare(b.item.productId!));
    // A returned shipment might already have entered the ordinary refund flow.
    const receipt = await tx.stockMovement.findFirst({ where: { orderId: order.id, OR: [
      { idempotencyKey: { startsWith: "order-return:" } }, { kind: "REFUND_RETURN" },
    ] } });
    if (receipt) throw new Error("Porudžbina već ima knjižen povrat. Prvo usaglasite postojeći povrat/refundaciju.");
    const retry = await tx.orderReshipment.create({ data: {
      orderId: order.id, sourceShipmentId: source.id, reason, actorId: input.actorId,
      codAmount: isCashOnDeliveryPaymentMethod(order.paymentMethod) && !order.payments.some(payment => payment.status === "PAID") ? source.codAmount ?? assignment?.codAmount ?? order.total : 0,
      items: { create: items.map(({ item, quantity }) => ({ orderItemId: item.id, productId: item.productId!, warehouseId: item.warehouseId!, sku: item.sku, name: item.name, quantity })) },
    }, include: { batch: true } });
    await tx.order.update({ where: { id: order.id }, data: { status: "U_PRIPREMI" } });
    for (const { item, quantity } of items) {
      await assertExtraStock(tx, item.productId!, item.warehouseId!, quantity);
      // Keep this separate from the original item's SALE_RESERVATION ledger:
      // fiscalization must still debit the original sale exactly once.
      await adjustInventory(tx, { idempotencyKey: `reshipment-out:${retry.id}:${item.id}`, productId: item.productId!, warehouseId: item.warehouseId!, sku: item.sku, qtyDelta: -quantity, kind: "ADJUSTMENT", orderId: order.id, actorId: input.actorId, note: `Nova roba izdvojena za ponovno slanje ${order.number}; ${quantity} kom, stavka ${item.id}, stara pošiljka ${source.trackingNo ?? source.id}.` });
    }
    await tx.orderStatusEvent.create({ data: { orderId: order.id, status: "U_PRIPREMI", actorId: input.actorId, note: `Nova roba je dostupna za učitavanje u picking. Stara pošiljka ${source.trackingNo ?? source.id} evidentirana je kao očekivani povrat, bez refundacije. Razlog: ${reason}` } });
    return retry;
  }, transactionOptions);
}

async function reshipmentSourceLines(
  tx: Prisma.TransactionClient,
  source: { orderId: string; provider: string | null; rawCreateResponse: Prisma.JsonValue },
) {
  const assignment = readShipmentAssignment(source.rawCreateResponse);
  const lines = await tx.pickupBatchLine.findMany({ where: {
    orderId: source.orderId, purpose: "ORDER_DELIVERY",
    lineGroupKey: assignment?.assignmentKey ?? `order:${source.orderId}:${source.provider}`,
    batch: { provider: source.provider, status: { in: ["BOOKED", "PICKED_UP"] } },
  }, orderBy: { packageNo: "asc" } });
  if (!lines.length || lines.some(line => !line.orderItemId || line.deferredAt || line.providerLabelCancelledAt)) throw new Error("Pošiljka nema kompletnu picking evidenciju. Prvo usaglasite odložene ili otkazane pakete.");
  return lines;
}

/** Runs inside the explicit load action's serializable transaction, with its batch locked. */
export async function loadPendingOrderReshipments(
  tx: Prisma.TransactionClient,
  batch: { id: string; number: string },
  provider: SmallParcelProvider,
  actorId: string,
) {
  const candidates = await tx.orderReshipment.findMany({
    where: { batchId: null, sourceShipment: { provider } },
    include: { items: true, sourceShipment: true, order: { include: { payments: true, paymentRefunds: true } } },
    orderBy: { id: "asc" },
  });
  let reshipmentCount = 0;
  let reshipmentLineCount = 0;
  for (const retry of candidates) {
    const order = retry.order;
    if (order.cancelledAt || order.stockRestoredAt || ["OTKAZANO", "ISPORUCENO"].includes(order.status) || order.paymentRefunds.length) continue;
    assertFulfillmentPaymentReady({ purpose: "ORDER_DELIVERY", orderNumber: order.number, paymentMethod: order.paymentMethod, paymentStatuses: order.payments.map(p => p.status) });
    // Reuse the shipped package layout; the new goods were already reserved when queued.
    const lines = await reshipmentSourceLines(tx, retry.sourceShipment);
    const quantities = new Map(retry.items.map(item => [item.orderItemId, item.quantity]));
    if (lines.some(line => !quantities.has(line.orderItemId!))) throw new Error("Stavke ponovnog slanja ne odgovaraju izvornoj picking evidenciji.");
    const claimed = await tx.orderReshipment.updateMany({
      where: { id: retry.id, batchId: null }, data: { batchId: batch.id },
    });
    if (!claimed.count) continue;
    await tx.pickupBatchLine.createMany({ data: lines.map((line, index) => ({
      batchId: batch.id, orderId: order.id, orderItemId: line.orderItemId, purpose: "ORDER_DELIVERY", lineGroupKey: `reshipment:${retry.id}`,
      quantity: line.packedItems ? line.packedQuantity : quantities.get(line.orderItemId!), packedQuantity: line.packedQuantity, packedItems: line.packedItems ?? Prisma.DbNull, packageNo: index + 1,
      weightKg: line.weightKg, widthCm: line.widthCm, depthCm: line.depthCm, heightCm: line.heightCm,
    })) });
    await tx.orderStatusEvent.create({ data: { orderId: order.id, status: order.status, actorId, note: `Nova roba za ponovno slanje učitana je u picking nalog ${batch.number}.` } });
    reshipmentCount += 1;
    reshipmentLineCount += lines.length;
  }
  return { reshipmentCount, reshipmentLineCount };
}

async function assertExtraStock(tx: Prisma.TransactionClient, productId: string, warehouseId: string, quantity: number) {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, include: {
    warehouseStocks: true,
    orderItems: { where: { warehouseReservedQty: { gt: 0 }, order: { status: { notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"] } } }, include: { stockMovements: true } },
    partnerReservations: { where: { status: "ACTIVE" } },
  } });
  const warehouse = await tx.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse?.active) throw new Error("Izvorni magacin nije aktivan.");
  const belongs = (id: string | null) => id === warehouseId || (!id && warehouse.isDefault);
  const balance = resolveStoredWarehouseBalance({
    storedQty: product.warehouseStocks.find(stock => stock.warehouseId === warehouseId)?.qty ?? (product.warehouseStocks.length ? 0 : product.stock),
    orderReservations: product.orderItems.filter(item => belongs(item.warehouseId)).map(item => ({ qty: item.warehouseReservedQty, debited: item.stockMovements.reduce((sum, m) => sum + m.qty, 0) < 0 })),
    partnerReserved: product.partnerReservations.filter(r => belongs(r.warehouseId) && (!r.expiresAt || r.expiresAt > new Date())).reduce((sum, r) => sum + r.qty, 0),
  });
  if (balance.available < quantity) throw new Error(`Nema dovoljno slobodne nove robe za ${product.sku} (potrebno ${quantity}, dostupno ${balance.available}).`);
}

export async function receiveReshipmentReturn(input: { itemId: string; unitNo: number; warehouseId: string; actorId: string }) {
  if (!input.warehouseId.trim()) throw new Error("Izaberite magacin prijema.");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OrderReshipmentItem" WHERE "id" = ${input.itemId} FOR UPDATE`;
    const item = await tx.orderReshipmentItem.findUniqueOrThrow({ where: { id: input.itemId }, include: { reshipment: { include: { order: true, sourceShipment: true } } } });
    if (!Number.isInteger(input.unitNo) || input.unitNo < 1 || input.unitNo > item.quantity) throw new Error("Neispravna jedinica povrata.");
    const key = `reshipment-return:${item.id}:${input.unitNo}`;
    if (await tx.stockMovement.findUnique({ where: { idempotencyKey: key } })) return;
    if (input.unitNo !== item.receivedQty + 1) throw new Error("Osvežite pregled primljenih količina.");
    await adjustInventory(tx, { idempotencyKey: key, productId: item.productId, sku: item.sku, warehouseId: input.warehouseId, qtyDelta: 1, kind: "ADJUSTMENT", orderId: item.reshipment.orderId, actorId: input.actorId, note: `Pregledana i primljena stara roba po ponovnom slanju ${item.reshipment.order.number}, pošiljka ${item.reshipment.sourceShipment.trackingNo ?? item.reshipment.sourceShipmentId}; ${input.unitNo}/${item.quantity}, ${item.sku}. Bez refundacije.` });
    await tx.orderReshipmentItem.update({ where: { id: item.id }, data: { receivedQty: { increment: 1 } } });
    await tx.orderStatusEvent.create({ data: { orderId: item.reshipment.orderId, status: item.reshipment.order.status, actorId: input.actorId, note: `Primljen povrat stare pošiljke: ${item.sku}, ${input.unitNo}/${item.quantity} kom. Porudžbina i nova isporuka ostaju aktivne.` } });
  }, transactionOptions);
}
