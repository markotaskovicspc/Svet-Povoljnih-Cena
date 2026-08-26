import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const PRESERVED_ORDER_NUMBER = "SPC-2026-000012";

function authorized(request: Request) {
  const expected = process.env.ADMIN_API_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
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
        select: { kind: true, status: true, receiptNumber: true, issuedAt: true },
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
        stockMovementKinds: order.stockMovements.map((movement) => movement.kind),
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
