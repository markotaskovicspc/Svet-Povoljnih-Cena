import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const PRESERVED_ORDER_NUMBER = "VP-2026-00012";

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
      include: {
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
      },
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
