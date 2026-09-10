import "server-only";

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

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
        items: { select: { id: true, sku: true, name: true, qty: true } },
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
