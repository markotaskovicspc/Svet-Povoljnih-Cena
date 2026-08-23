import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { restoreOrderReservations } from "@/lib/order-reservations";
import {
  canCustomerCancelStatus,
  OrderCancellationError,
} from "./cancellation";

const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export async function cancelWebOrderByCustomer(input: {
  orderId: string;
  requestedByUserId?: string | null;
}) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE
    `);
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      include: {
        fiscal: { select: { id: true } },
        fiscalDocuments: {
          where: { kind: "SALE" },
          select: { id: true, status: true },
        },
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
        items: {
          select: {
            id: true,
            productId: true,
            sku: true,
            name: true,
            qty: true,
            warehouseReservedQty: true,
            warehouseDispatchedQty: true,
            supplierReservedQty: true,
            warehouse: { select: { email: true } },
          },
        },
        pickupBatchLines: {
          include: {
            batch: {
              select: {
                id: true,
                number: true,
                status: true,
                labelsCreationStartedAt: true,
                labelsCreatedAt: true,
              },
            },
          },
        },
        shipments: {
          where: { purpose: "ORDER_DELIVERY", status: { not: "FAILED" } },
          select: { id: true },
        },
      },
    });
    if (!order) {
      throw new OrderCancellationError("Porudžbina ne postoji.", "NOT_FOUND");
    }
    if (order.status === "OTKAZANO") {
      return {
        alreadyCancelled: true,
        orderId: order.id,
        orderNumber: order.number,
        supplierCancellationIds: [] as string[],
        warehouseRecipients: [] as string[],
        pickupBatchNumbers: [] as string[],
        removedPickupLines: 0,
        activeShipmentCount: 0,
        paymentReviewRequired: false,
      };
    }
    if (order.channel !== "WEB" || !canCustomerCancelStatus(order.status)) {
      throw new OrderCancellationError(
        "Porudžbina je već u fazi u kojoj je ne možete samostalno otkazati. Kontaktirajte podršku.",
        "NOT_ALLOWED",
      );
    }
    if (order.fiscal || order.fiscalDocuments.length) {
      throw new OrderCancellationError(
        "Porudžbina je fiskalizovana i više se ne može otkazati ovim putem.",
        "FISCALIZED",
      );
    }

    const fiscalJobKeys = [
      `fiscal-advance:${order.id}`,
      `fiscal-pickup:${order.id}`,
    ];
    const fiscalJobs = await tx.backgroundJob.findMany({
      where: { idempotencyKey: { in: fiscalJobKeys } },
      select: { id: true, status: true },
    });
    if (fiscalJobs.some((job) => job.status === "RUNNING")) {
      throw new OrderCancellationError(
        "Fiskalizacija se upravo obrađuje. Sačekajte i proverite status porudžbine.",
        "IN_PROGRESS",
      );
    }
    await tx.backgroundJob.updateMany({
      where: {
        id: { in: fiscalJobs.map((job) => job.id) },
        status: { in: ["QUEUED", "RETRY"] },
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        lockedAt: null,
        lastError: "Otkazano na zahtev kupca pre fiskalizacije.",
      },
    });

    const pickupBatches = Array.from(
      new Map(
        order.pickupBatchLines.map((line) => [line.batch.id, line.batch]),
      ).values(),
    );
    const removableBatchIds = pickupBatches
      .filter(
        (batch) =>
          batch.status === "DRAFT" &&
          !batch.labelsCreationStartedAt &&
          !batch.labelsCreatedAt,
      )
      .map((batch) => batch.id);
    const removedPickupLines = removableBatchIds.length
      ? await tx.pickupBatchLine.deleteMany({
          where: { orderId: order.id, batchId: { in: removableBatchIds } },
        })
      : { count: 0 };

    const restored = await restoreOrderReservations(tx, {
      orderId: order.id,
      orderNumber: order.number,
      items: order.items,
      reasonKey: "customer-cancel",
      note: `Kupac otkazao porudžbinu ${order.number} pre fiskalizacije.`,
    });
    const now = new Date();
    await tx.order.update({
      where: { id: order.id },
      data: { status: "OTKAZANO", cancelledAt: now, stockRestoredAt: now },
    });
    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: "OTKAZANO",
        actorId: null,
        note: input.requestedByUserId
          ? "Kupac je otkazao porudžbinu kroz Moj nalog pre fiskalizacije."
          : "Kupac je otkazao porudžbinu kroz zaštićeni link pre fiskalizacije.",
      },
    });

    const payment = order.payments[0];
    const paymentReviewRequired = Boolean(
      payment && ["AUTHORIZED", "PAID", "PARTIAL_REFUND"].includes(payment.status),
    );
    if (payment && paymentReviewRequired) {
      await tx.paymentRefund.upsert({
        where: { idempotencyKey: `customer-cancel:${order.id}` },
        create: {
          orderId: order.id,
          idempotencyKey: `customer-cancel:${order.id}`,
          method: order.paymentMethod,
          provider: payment.provider,
          status: "NEEDS_REVIEW",
          amount: payment.amount,
          error: "Kupac je otkazao pre fiskalizacije; proveriti/izvršiti povraćaj kod provajdera.",
        },
        update: {},
      });
    }

    const configuredWarehouseRecipients = order.items
      .map((item) => item.warehouse?.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email));
    if (!configuredWarehouseRecipients.length && pickupBatches.length) {
      const defaultWarehouse = await tx.warehouse.findFirst({
        where: { active: true, isDefault: true, email: { not: null } },
        select: { email: true },
      });
      if (defaultWarehouse?.email) {
        configuredWarehouseRecipients.push(defaultWarehouse.email.trim().toLowerCase());
      }
    }

    const warehouseRecipients = Array.from(
      new Set(configuredWarehouseRecipients),
    );
    await enqueueBackgroundJob(
      {
        kind: "ORDER_STATUS_EMAIL",
        payload: { orderId: order.id, status: "OTKAZANO" },
        idempotencyKey: `order-status-email:${order.id}:OTKAZANO`,
      },
      tx,
    );
    for (const fulfillmentId of restored.supplierCancellationIds) {
      await enqueueBackgroundJob(
        {
          kind: "SUPPLIER_CANCEL_EMAIL",
          payload: { fulfillmentId },
          idempotencyKey: `supplier-cancel:${fulfillmentId}`,
        },
        tx,
      );
    }
    if (
      warehouseRecipients.length &&
      (pickupBatches.length || order.shipments.length)
    ) {
      await enqueueBackgroundJob(
        {
          kind: "ORDER_CANCELLATION_WAREHOUSE_EMAIL",
          payload: {
            orderId: order.id,
            recipients: warehouseRecipients,
            pickupBatchNumbers: pickupBatches.map((batch) => batch.number),
            removedPickupLines: removedPickupLines.count,
            activeShipmentCount: order.shipments.length,
          },
          idempotencyKey: `warehouse-order-cancel:${order.id}`,
        },
        tx,
      );
    }

    return {
      alreadyCancelled: false,
      orderId: order.id,
      orderNumber: order.number,
      supplierCancellationIds: restored.supplierCancellationIds,
      warehouseRecipients,
      pickupBatchNumbers: pickupBatches.map((batch) => batch.number),
      removedPickupLines: removedPickupLines.count,
      activeShipmentCount: order.shipments.length,
      paymentReviewRequired,
    };
  }, TRANSACTION_OPTIONS);

  return result;
}
