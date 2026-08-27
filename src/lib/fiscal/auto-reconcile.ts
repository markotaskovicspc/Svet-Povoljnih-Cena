import "server-only";

import { Prisma, type PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const ALL_SALES_CHANNELS = ["WEB", "ANANAS", "MP", "VP", "INO"] as const;
const CASH_ON_DELIVERY_METHODS: PaymentMethod[] = [
  "POUZECE_GOTOVINA",
  "POUZECE_KARTICA",
];
const PICKED_UP_OR_LATER = [
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

export interface FiscalAutoSummary {
  scanned: number;
  eligible: number;
  eligibleAdvance: number;
  eligiblePickup: number;
  queued: number;
  skippedUnderpaid: number;
  failed: number;
}

/**
 * Queues eligible orders from every sales channel that have never started SALE
 * fiscalization. Prepaid/manual orders must be fully paid; cash-on-delivery
 * orders become eligible only after the delivery shipment has been picked up.
 *
 * Existing SALE documents (including PENDING/FAILED) are deliberately excluded:
 * the fiscal retry cron owns those records and applies its provider-safety rules.
 * The durable job key makes overlapping hourly cron invocations idempotent.
 */
export async function enqueueEligibleOrdersForFiscalization(
  requestedLimit = DEFAULT_LIMIT,
): Promise<FiscalAutoSummary> {
  const limit = Math.min(
    Math.max(Math.trunc(requestedLimit) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );
  const orders = await db.order.findMany({
    where: {
      channel: { in: [...ALL_SALES_CHANNELS] },
      status: { notIn: ["OTKAZANO", "VRACENO"] },
      total: { gt: 0 },
      items: { some: {} },
      fiscalDocuments: { none: { kind: "SALE" } },
      OR: [
        {
          paymentMethod: { notIn: CASH_ON_DELIVERY_METHODS },
          payments: { some: { status: "PAID" } },
        },
        {
          paymentMethod: { in: CASH_ON_DELIVERY_METHODS },
          shipments: {
            some: {
              purpose: "ORDER_DELIVERY",
              status: { in: [...PICKED_UP_OR_LATER] },
            },
          },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      number: true,
      channel: true,
      total: true,
      paymentMethod: true,
      payments: {
        where: { status: "PAID" },
        select: { amount: true },
      },
    },
  });

  const summary: FiscalAutoSummary = {
    scanned: orders.length,
    eligible: 0,
    eligibleAdvance: 0,
    eligiblePickup: 0,
    queued: 0,
    skippedUnderpaid: 0,
    failed: 0,
  };

  for (const order of orders) {
    const cashOnDelivery = CASH_ON_DELIVERY_METHODS.includes(
      order.paymentMethod,
    );
    if (!cashOnDelivery) {
      const paidTotal = order.payments.reduce(
        (sum, payment) => sum.plus(payment.amount),
        new Prisma.Decimal(0),
      );
      if (paidTotal.lessThan(order.total)) {
        summary.skippedUnderpaid += 1;
        continue;
      }
    }

    const source = cashOnDelivery ? "AUTO_PICKUP" : "AUTO_ADVANCE";
    summary.eligible += 1;
    if (cashOnDelivery) summary.eligiblePickup += 1;
    else summary.eligibleAdvance += 1;
    try {
      await enqueueBackgroundJob({
        kind: "FISCAL_RECEIPT",
        payload: {
          orderId: order.id,
          source,
          paymentMethod: order.paymentMethod,
        },
        idempotencyKey:
          source === "AUTO_PICKUP"
            ? `fiscal-pickup:${order.id}`
            : `fiscal-advance:${order.id}`,
      });
      summary.queued += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[fiscal:auto] queue failed for ${order.channel} ${order.number} (${order.id}): ${message}`,
      );
    }
  }

  return summary;
}
