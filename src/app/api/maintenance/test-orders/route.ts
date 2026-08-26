import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const TARGET_SUFFIXES = [
  "26-000042",
  "26-000043",
  "26-000044",
  "26-000045",
  "26-000046",
  "26-000047",
] as const;

const DAY_START = new Date("2026-08-25T22:00:00.000Z");
const DAY_END = new Date("2026-08-26T22:00:00.000Z");

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
    where: {
      createdAt: { gte: DAY_START, lt: DAY_END },
      OR: TARGET_SUFFIXES.map((suffix) => ({ number: { endsWith: suffix } })),
    },
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
          service: true,
          status: true,
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
      pickupBatchLines: { select: { batchId: true } },
      supplierFulfillments: { select: { status: true } },
    },
  });

  return NextResponse.json(
    {
      targets: TARGET_SUFFIXES,
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
          service: shipment.service,
          status: shipment.status,
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
        pickupBatchCount: order.pickupBatchLines.length,
        supplierFulfillments: order.supplierFulfillments,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
