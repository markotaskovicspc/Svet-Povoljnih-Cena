import "server-only";

import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteMyGlsLabelsForShipment } from "@/lib/mygls/shipments";
import { restoreOrderReservations } from "@/lib/order-reservations";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CUTOFF = new Date("2026-08-26T15:00:00.000Z"); // 17:00 Europe/Belgrade
const PROTECTED_ORDER_NUMBERS = ["VP-2026-00011", "VP-2026-00012"];
const DELETE_CONFIRMATION = "DELETE_BEFORE_2026_08_26_17_EXCEPT_SINAGOGA";

const ORDER_ARCHIVE_INCLUDE = {
  items: true,
  events: true,
  payments: true,
  shipments: { include: { events: true } },
  invoices: true,
  fiscal: true,
  fiscalDocuments: {
    include: {
      lines: true,
      paymentRefunds: true,
      stockMovements: true,
    },
  },
  paymentRefunds: true,
  stockMovements: true,
  reclamations: {
    include: {
      photos: true,
      events: true,
      shipments: { include: { events: true } },
      pickupBatchLines: true,
    },
  },
  voucherRedemption: true,
  checkoutSessions: true,
  dispatchNotes: { include: { items: true, stockMovements: true } },
  pickupBatchLines: { include: { batch: true } },
  analyticsEvents: true,
  supplierFulfillments: { include: { items: true } },
} satisfies Prisma.OrderInclude;

function authorized(request: Request) {
  const expected = process.env.ADMIN_API_SECRET?.trim();
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function targetWhere(): Prisma.OrderWhereInput {
  return {
    createdAt: { lt: CUTOFF },
    number: { notIn: PROTECTED_ORDER_NUMBERS },
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targetOrders = await db.order.findMany({
    where: targetWhere(),
    orderBy: { createdAt: "asc" },
    include: ORDER_ARCHIVE_INCLUDE,
  });
  const protectedOrders = await db.order.findMany({
    where: { number: { in: PROTECTED_ORDER_NUMBERS } },
    orderBy: { createdAt: "asc" },
    select: { id: true, number: true, createdAt: true, status: true },
  });

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      cutoff: CUTOFF.toISOString(),
      protectedOrderNumbers: PROTECTED_ORDER_NUMBERS,
      protectedOrders,
      targetCount: targetOrders.length,
      targetOrders,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    confirmation?: unknown;
    targetOrderNumbers?: unknown;
  } | null;
  if (
    body?.confirmation !== DELETE_CONFIRMATION ||
    !Array.isArray(body.targetOrderNumbers) ||
    !body.targetOrderNumbers.every(
      (number): number is string =>
        typeof number === "string" && number.trim().length > 0,
    )
  ) {
    return NextResponse.json(
      { error: "Invalid confirmation." },
      { status: 400 },
    );
  }

  const requestedNumbers = Array.from(
    new Set(body.targetOrderNumbers.map((number) => number.trim())),
  ).sort();
  const expectedOrders = await db.order.findMany({
    where: targetWhere(),
    orderBy: { number: "asc" },
    select: { number: true },
  });
  const expectedNumbers = expectedOrders.map((order) => order.number).sort();
  if (
    expectedNumbers.length === 0 ||
    requestedNumbers.length !== expectedNumbers.length ||
    requestedNumbers.some((number, index) => number !== expectedNumbers[index])
  ) {
    return NextResponse.json(
      {
        error: "Target list does not exactly match the protected cutoff rule.",
        expectedCount: expectedNumbers.length,
        requestedCount: requestedNumbers.length,
      },
      { status: 409 },
    );
  }

  const protectedCount = await db.order.count({
    where: { number: { in: PROTECTED_ORDER_NUMBERS } },
  });
  if (protectedCount !== PROTECTED_ORDER_NUMBERS.length) {
    return NextResponse.json(
      { error: "One or more protected Sinagoga orders are missing." },
      { status: 409 },
    );
  }

  const targetOrders = await db.order.findMany({
    where: { number: { in: expectedNumbers } },
    orderBy: { createdAt: "asc" },
    include: ORDER_ARCHIVE_INCLUDE,
  });
  if (
    targetOrders.length !== expectedNumbers.length ||
    targetOrders.some(
      (order) =>
        order.createdAt >= CUTOFF ||
        PROTECTED_ORDER_NUMBERS.includes(order.number),
    )
  ) {
    return NextResponse.json(
      { error: "Production changed during validation; nothing was deleted." },
      { status: 409 },
    );
  }

  const myGlsShipments = targetOrders.flatMap((order) =>
    order.shipments
      .filter(
        (shipment) =>
          shipment.provider === "MYGLS" && shipment.status === "CREATED",
      )
      .map((shipment) => ({
        shipmentId: shipment.id,
        orderNumber: order.number,
      })),
  );
  const cancelledMyGlsLabels: string[] = [];
  for (const shipment of myGlsShipments) {
    await deleteMyGlsLabelsForShipment(shipment.shipmentId);
    cancelledMyGlsLabels.push(shipment.orderNumber);
  }

  const result = await db.$transaction(
    async (tx) => {
      for (const order of targetOrders) {
        await tx.auditLog.create({
          data: {
            action: "maintenance.test-order-cleanup.backup",
            entity: "Order",
            entityId: order.id,
            diff: JSON.parse(
              JSON.stringify({
                cutoff: CUTOFF.toISOString(),
                protectedOrderNumbers: PROTECTED_ORDER_NUMBERS,
                archivedAt: new Date().toISOString(),
                order,
              }),
            ) as Prisma.InputJsonValue,
          },
        });
      }

      for (const order of targetOrders) {
        await restoreOrderReservations(tx, {
          orderId: order.id,
          orderNumber: order.number,
          items: order.items,
          reasonKey: "maintenance-test-cleanup-final",
          note: `Povrat rezervacije pre uklanjanja test porudžbine ${order.number}.`,
        });
      }

      const orderIds = targetOrders.map((order) => order.id);
      const shipmentIds = targetOrders.flatMap((order) =>
        order.shipments.map((shipment) => shipment.id),
      );
      await tx.xExpressWebhookEvent.updateMany({
        where: {
          OR: [
            { orderId: { in: orderIds } },
            { shipmentId: { in: shipmentIds } },
          ],
        },
        data: { orderId: null, shipmentId: null },
      });
      await tx.voucherRedemption.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await tx.reclamation.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.fiscalReceipt.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      const deleted = await tx.order.deleteMany({
        where: { id: { in: orderIds } },
      });
      const deletedEmptyPickupBatches = await tx.pickupBatch.deleteMany({
        where: {
          status: "DRAFT",
          externalBookedAt: null,
          externalBookingReference: null,
          lines: { none: {} },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "maintenance.test-order-cleanup.complete",
          entity: "OrderCleanup",
          diff: {
            cutoff: CUTOFF.toISOString(),
            protectedOrderNumbers: PROTECTED_ORDER_NUMBERS,
            deletedOrderNumbers: expectedNumbers,
            deletedCount: deleted.count,
            cancelledMyGlsLabels,
            deletedEmptyPickupBatchCount: deletedEmptyPickupBatches.count,
          },
        },
      });
      return {
        deletedCount: deleted.count,
        deletedEmptyPickupBatchCount: deletedEmptyPickupBatches.count,
      };
    },
    { maxWait: 15_000, timeout: 120_000 },
  );

  return NextResponse.json(
    {
      ok: true,
      cutoff: CUTOFF.toISOString(),
      protectedOrderNumbers: PROTECTED_ORDER_NUMBERS,
      deletedOrderNumbers: expectedNumbers,
      cancelledMyGlsLabels,
      ...result,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
