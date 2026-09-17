import "server-only";

import { db } from "@/lib/db";
import { StockMovementKind, type Prisma } from "@prisma/client";
import { adjustInventory } from "@/lib/inventory";

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
        items: {
          select: {
            id: true,
            productId: true,
            sku: true,
            name: true,
            qty: true,
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
}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-return-receipt:${args.orderId}:${args.orderItemId}:${args.unitNo}`}))::text AS "lock"`;
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
    const movement = await adjustInventory(tx, {
      idempotencyKey: `order-return:${order.number}:${item.id}:${args.unitNo}`,
      productId: item.productId,
      sku: item.sku,
      qtyDelta: 1,
      warehouseId: warehouse.id,
      kind: StockMovementKind.REFUND_RETURN,
      note: `Paket ${args.unitNo}/${item.qty} vraćene porudžbine ${order.number} pregledan i primljen u ${warehouse.code} · ${warehouse.name}.`,
      actorId: args.actorId,
      orderId: args.orderId,
      orderItemId: item.id,
    });
    return { movement, warehouse };
  }, { maxWait: 10_000, timeout: 30_000 });
}
