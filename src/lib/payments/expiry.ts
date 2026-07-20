import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { restoreOrderReservations } from "@/lib/order-reservations";

const EXPIRABLE_PAYMENT_METHODS = [
  "IPS",
  "KARTICA",
  "GOOGLE_PAY",
  "APPLE_PAY",
] as const;

export async function expirePendingPayments(limit = 100) {
  const now = new Date();
  const orders = await db.order.findMany({
    where: {
      status: "KREIRANO",
      stockRestoredAt: null,
      expiresAt: { lt: now },
      paymentMethod: { in: [...EXPIRABLE_PAYMENT_METHODS] },
      payments: { some: { status: "PENDING", expiresAt: { lt: now } } },
    },
    take: Math.min(Math.max(limit, 1), 500),
    orderBy: { expiresAt: "asc" },
    include: {
      items: {
        select: {
          id: true,
          productId: true,
          qty: true,
          sku: true,
          warehouseReservedQty: true,
          supplierReservedQty: true,
        },
      },
      payments: {
        where: { status: "PENDING" },
        select: { id: true, expiresAt: true },
      },
    },
  });

  let expired = 0;
  let restoredLines = 0;
  for (const order of orders) {
    const supplierCancellations: string[] = [];
    await db.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: {
          id: order.id,
          status: "KREIRANO",
          stockRestoredAt: null,
        },
        data: {
          status: "OTKAZANO",
          cancelledAt: now,
          stockRestoredAt: now,
        },
      });
      if (updated.count !== 1) return;

      await tx.payment.updateMany({
        where: { orderId: order.id, status: "PENDING" },
        data: {
          status: "FAILED",
          rawResponse: {
            reason: "payment_expired",
            expiredAt: now.toISOString(),
          } satisfies Prisma.InputJsonObject,
        },
      });

      const restored = await restoreOrderReservations(tx, {
        orderId: order.id,
        orderNumber: order.number,
        items: order.items,
        reasonKey: "payment-expiry",
        note: `Istek plaćanja za porudžbinu ${order.number}`,
      });
      restoredLines += restored.warehouseLines;
      supplierCancellations.push(...restored.supplierCancellationIds);

      await tx.orderStatusEvent.create({
        data: {
          orderId: order.id,
          status: "OTKAZANO",
          note: "Online plaćanje je isteklo; rezervisana količina je vraćena na lager.",
        },
      });
      expired += 1;
    });
    await Promise.all(
      supplierCancellations.map((fulfillmentId) =>
        enqueueBackgroundJob({
          kind: "SUPPLIER_CANCEL_EMAIL",
          payload: { fulfillmentId },
          idempotencyKey: `supplier-cancel:${fulfillmentId}`,
        }),
      ),
    );
  }

  return { scanned: orders.length, expired, restoredLines };
}
