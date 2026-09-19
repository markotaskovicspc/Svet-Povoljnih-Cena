import "server-only";

import { db } from "@/lib/db";
import { StockMovementKind, type Prisma } from "@prisma/client";
import { adjustInventory } from "@/lib/inventory";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { returnedStockBalance } from "@/lib/fiscal/return-stock";
import { lockOrderReturn } from "@/lib/fiscal/return-lock";

// Courier returns belong to the original order. They do not require a
// reclamation or a separately created RECLAMATION_RETURN shipment.
const returnedOrdersWhere = {
  OR: [
    { status: "VRACENO" },
    { shipments: { some: { purpose: "ORDER_DELIVERY", status: "RETURNED" } } },
  ],
} satisfies Prisma.OrderWhereInput;

export async function listReturnedOrders() {
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where: returnedOrdersWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 500,
      select: {
        id: true,
        number: true,
        paymentRefunds: { select: { status: true, error: true } },
        items: {
          select: {
            id: true,
            productId: true,
            sku: true,
            name: true,
            qty: true,
            fiscalLines: { where: { fiscalDocument: { kind: "SALE", status: "ISSUED" } }, select: { refundedQty: true } },
          },
        },
        shipments: {
          where: { purpose: "ORDER_DELIVERY", status: "RETURNED" },
          orderBy: { createdAt: "desc" },
          select: { id: true, provider: true, trackingNo: true, lastStatusEventAt: true },
        },
      },
    }),
    db.order.count({ where: returnedOrdersWhere }),
  ]);
  return { orders, total };
}

export async function receiveReturnedOrderUnit(args: {
  orderId: string;
  orderItemId: string;
  unitNo: number;
  warehouseId: string;
  actorId: string;
  buyerId?: string;
}) {
  return db.$transaction(async (tx) => {
    await lockOrderReturn(tx, args.orderId);
    const order = await tx.order.findFirst({
      where: { id: args.orderId, ...returnedOrdersWhere },
      select: {
        number: true,
        items: {
          where: { id: args.orderItemId },
          select: { id: true, productId: true, sku: true, qty: true },
          take: 1,
        },
      },
    });
    const item = order?.items[0];
    if (!order || !item) throw new Error("Vraćeni paket nije pronađen.");
    if (!item.productId) {
      throw new Error("Artikal nema vezu sa lagerom i ne može da se proknjiži.");
    }
    if (!Number.isInteger(args.unitNo) || args.unitNo < 1 || args.unitNo > item.qty) {
      throw new Error("Broj fizičkog paketa nije ispravan.");
    }
    const warehouse = await tx.warehouse.findFirst({
      where: { id: args.warehouseId, active: true },
      select: { id: true, code: true, name: true },
    });
    if (!warehouse) throw new Error("Izaberite aktivan magacin prijema.");
    const key = `order-return:${order.number}:${item.id}:${args.unitNo}`;
    const existing = await tx.stockMovement.findUnique({ where: { idempotencyKey: key } });
    let movement = existing;
    if (!movement) {
      const balance = await returnedStockBalance(tx, item.id);
      const qtyDelta = Math.max(0, Math.max(balance.received + 1, balance.refunded) - balance.posted);
      if (!qtyDelta && balance.movements.some(row => row.qty > 0 && row.warehouseId !== warehouse.id)) {
        throw new Error("Roba je već vraćena na stanje drugog magacina kroz refundaciju. Proverite stanje i evidentirajte prenos pre prijema.");
      }
      const adjustment = {
      idempotencyKey: `order-return:${order.number}:${item.id}:${args.unitNo}`,
      productId: item.productId,
      sku: item.sku,
      qtyDelta,
      warehouseId: warehouse.id,
      kind: StockMovementKind.REFUND_RETURN,
      note: `Paket ${args.unitNo}/${item.qty} vraćene porudžbine ${order.number} pregledan i primljen u ${warehouse.code} · ${warehouse.name}.`,
      actorId: args.actorId,
      orderId: args.orderId,
      orderItemId: item.id,
      };
      movement = qtyDelta > 0 ? await adjustInventory(tx, adjustment) : await tx.stockMovement.create({
        data: { idempotencyKey: key, productId: item.productId, sku: item.sku, qty: 0,
          warehouseId: warehouse.id, kind: "REFUND_RETURN", orderId: args.orderId,
          orderItemId: item.id, actorId: args.actorId,
          note: "Paket primljen; lager je već vraćen fiskalnom refundacijom." },
      });
    }
    const jobKey = `return-fiscal:${movement.id}`;
    // Check under the order lock before inserting: a duplicate INSERT would
    // abort this PostgreSQL transaction before enqueueBackgroundJob can recover.
    const existingJob = await tx.backgroundJob.findUnique({
      where: { idempotencyKey: jobKey }, select: { id: true, status: true, payload: true },
    });
    const job = existingJob ?? await enqueueBackgroundJob({
      kind: "RETURN_FISCAL_REFUND", idempotencyKey: jobKey,
      payload: { movementId: movement.id, buyerId: args.buyerId?.trim() || undefined, actorId: args.actorId },
    }, tx);
    // Retry a failed job or supply missing identity without racing a running worker.
    if (existingJob && (existingJob.status === "FAILED" || args.buyerId?.trim())) {
      const payload = args.buyerId?.trim()
        ? { movementId: movement.id, buyerId: args.buyerId.trim(), actorId: args.actorId }
        : existingJob.payload as Prisma.InputJsonObject;
      await tx.backgroundJob.updateMany({
        where: { id: job.id, status: { in: ["QUEUED", "RETRY", "FAILED"] } },
        data: { payload, status: "QUEUED", attempts: 0, availableAt: new Date(), lastError: null },
      });
    }
    return { movement, warehouse, jobId: job.id };
  }, { maxWait: 10_000, timeout: 30_000 });
}
