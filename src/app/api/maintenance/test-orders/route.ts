import "server-only";

import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteMyGlsLabelsForShipment } from "@/lib/mygls/shipments";
import { restoreOrderReservations } from "@/lib/order-reservations";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PRESERVED_ORDER_NUMBER = "VP-2026-00012";
const DELETE_CONFIRMATION = `DELETE_ALL_EXCEPT_${PRESERVED_ORDER_NUMBER}`;

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
  dispatchNotes: {
    include: { items: true, stockMovements: true },
  },
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

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);

  if (url.searchParams.get("archive") === "1") {
    const targetOrders = await db.order.findMany({
      where: { number: { not: PRESERVED_ORDER_NUMBER } },
      orderBy: { createdAt: "asc" },
      include: ORDER_ARCHIVE_INCLUDE,
    });

    const preservedOrder = await db.order.findUnique({
      where: { number: PRESERVED_ORDER_NUMBER },
      select: { id: true, number: true, createdAt: true, status: true },
    });

    return NextResponse.json(
      {
        exportedAt: new Date().toISOString(),
        preservedOrderNumber: PRESERVED_ORDER_NUMBER,
        preservedOrder,
        targetCount: targetOrders.length,
        targetOrders,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const orders = await db.order.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      number: true,
      createdAt: true,
      channel: true,
      status: true,
      paymentMethod: true,
      shippingMethod: true,
      total: true,
      guestEmail: true,
      shipFirstName: true,
      shipLastName: true,
      notes: true,
      items: { select: { sku: true, qty: true } },
      payments: {
        select: {
          provider: true,
          status: true,
          providerRef: true,
          paidAt: true,
        },
      },
      shipments: {
        select: {
          id: true,
          provider: true,
          service: true,
          status: true,
          providerStatusCode: true,
          providerOrderId: true,
          providerShipmentId: true,
          trackingNo: true,
        },
      },
      invoices: { select: { kind: true, status: true, emailedAt: true } },
      fiscal: { select: { receiptNumber: true, fiscalizedAt: true } },
      fiscalDocuments: {
        select: {
          kind: true,
          status: true,
          receiptNumber: true,
          issuedAt: true,
        },
      },
      stockMovements: { select: { kind: true } },
      reclamations: { select: { number: true, status: true } },
      dispatchNotes: { select: { number: true, status: true } },
      pickupBatchLines: {
        select: {
          batch: {
            select: {
              id: true,
              number: true,
              status: true,
              externalBookedAt: true,
              externalBookingReference: true,
            },
          },
        },
      },
      supplierFulfillments: { select: { status: true } },
    },
  });

  return NextResponse.json(
    {
      preservedOrderNumber: PRESERVED_ORDER_NUMBER,
      orders: orders.map((order) => ({
        id: order.id,
        number: order.number,
        createdAt: order.createdAt,
        channel: order.channel,
        status: order.status,
        paymentMethod: order.paymentMethod,
        shippingMethod: order.shippingMethod,
        total: order.total.toString(),
        items: order.items,
        testSignals: {
          email: /test|example/i.test(order.guestEmail ?? ""),
          name: /test/i.test(`${order.shipFirstName} ${order.shipLastName}`),
          notes: /test/i.test(order.notes ?? ""),
        },
        payments: order.payments.map((payment) => ({
          provider: payment.provider,
          status: payment.status,
          hasProviderReference: Boolean(payment.providerRef),
          paidAt: payment.paidAt,
        })),
        shipments: order.shipments.map((shipment) => ({
          id: shipment.id,
          provider: shipment.provider,
          service: shipment.service,
          status: shipment.status,
          providerStatusCode: shipment.providerStatusCode,
          submitted: Boolean(
            shipment.providerOrderId ||
            shipment.providerShipmentId ||
            shipment.trackingNo,
          ),
        })),
        invoices: order.invoices,
        fiscal: order.fiscal,
        fiscalDocuments: order.fiscalDocuments,
        stockMovementKinds: order.stockMovements.map(
          (movement) => movement.kind,
        ),
        reclamations: order.reclamations,
        dispatchNotes: order.dispatchNotes,
        pickupBatches: Array.from(
          new Map(
            order.pickupBatchLines.map((line) => [line.batch.id, line.batch]),
          ).values(),
        ).map((batch) => ({
          number: batch.number,
          status: batch.status,
          externallyBooked: Boolean(
            batch.externalBookedAt || batch.externalBookingReference,
          ),
        })),
        supplierFulfillments: order.supplierFulfillments,
      })),
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

  const targetOrderNumbers = Array.from(
    new Set(body.targetOrderNumbers.map((number) => number.trim())),
  ).sort();
  if (
    targetOrderNumbers.length === 0 ||
    targetOrderNumbers.length > 200 ||
    targetOrderNumbers.includes(PRESERVED_ORDER_NUMBER)
  ) {
    return NextResponse.json({ error: "Unsafe target list." }, { status: 400 });
  }

  const preservedOrder = await db.order.findUnique({
    where: { number: PRESERVED_ORDER_NUMBER },
    select: { id: true },
  });
  if (!preservedOrder) {
    return NextResponse.json(
      { error: `Protected order ${PRESERVED_ORDER_NUMBER} is missing.` },
      { status: 409 },
    );
  }

  const targetOrders = await db.order.findMany({
    where: { number: { in: targetOrderNumbers } },
    orderBy: { createdAt: "asc" },
    include: ORDER_ARCHIVE_INCLUDE,
  });
  if (targetOrders.length !== targetOrderNumbers.length) {
    const found = new Set(targetOrders.map((order) => order.number));
    return NextResponse.json(
      {
        error: "Target list no longer matches production.",
        missing: targetOrderNumbers.filter((number) => !found.has(number)),
      },
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
            action: "maintenance.order-cleanup.backup",
            entity: "Order",
            entityId: order.id,
            diff: JSON.parse(
              JSON.stringify({
                preservedOrderNumber: PRESERVED_ORDER_NUMBER,
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
          reasonKey: "maintenance-test-cleanup",
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
          action: "maintenance.order-cleanup.complete",
          entity: "OrderCleanup",
          diff: {
            preservedOrderNumber: PRESERVED_ORDER_NUMBER,
            deletedOrderNumbers: targetOrderNumbers,
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
      preservedOrderNumber: PRESERVED_ORDER_NUMBER,
      deletedOrderNumbers: targetOrderNumbers,
      cancelledMyGlsLabels,
      ...result,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
