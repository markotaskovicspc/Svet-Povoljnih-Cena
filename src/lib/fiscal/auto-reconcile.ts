import "server-only";

import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const ALL_SALES_CHANNELS = ["WEB", "ANANAS", "MP", "VP", "INO"] as const;
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
 * fiscalization. Every payment method follows the same trigger: the delivery
 * shipment must have been picked up by the courier.
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
      shipments: {
        some: {
          purpose: "ORDER_DELIVERY",
          status: { in: [...PICKED_UP_OR_LATER] },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      number: true,
      channel: true,
      paymentMethod: true,
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
    summary.eligible += 1;
    summary.eligiblePickup += 1;
    try {
      await enqueueBackgroundJob({
        kind: "FISCAL_RECEIPT",
        payload: {
          orderId: order.id,
          source: "AUTO_PICKUP",
          paymentMethod: order.paymentMethod,
        },
        idempotencyKey: `fiscal-pickup:${order.id}`,
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
