import "server-only";

import { db } from "@/lib/db";
import { issueAndDeliverFiscalReceipt } from "./deliver";
import { isUnsafeFiscalRedispatch } from "./retry-safety";

const MAX_ATTEMPTS = 5;
const MIN_AGE_MS = 10 * 60 * 1000;

export interface FiscalRetrySummary {
  scanned: number;
  retried: number;
  issued: number;
  skippedUnsafe: number;
  failed: number;
}

/**
 * Re-issue SALE fiscal documents stuck in PENDING/FAILED.
 *
 * badi has no idempotency mechanism, so a dispatched request whose
 * response was lost (`fiscal:network` after `dispatchedAt` was set) may
 * have produced a receipt on the provider side. Those documents are
 * never auto-retried — they stay put for manual review against the
 * badi dashboard. Safe to retry are documents that were never
 * dispatched, or that the provider logically rejected (`fiscal:4xx` —
 * no receipt exists).
 *
 * Retrying goes through `issueAndDeliverFiscalReceipt`, which recomputes
 * the idempotency key and reuses the stuck document, so the customer
 * email also fires on late success. REFUND documents are excluded: they
 * carry stock/payment side effects and are re-submitted from the admin UI.
 */
export async function retryPendingFiscalDocuments(limit = 25): Promise<FiscalRetrySummary> {
  const documents = await db.fiscalDocument.findMany({
    where: {
      kind: "SALE",
      OR: [
        { status: { in: ["PENDING", "FAILED"] } },
        {
          status: "ISSUED",
          lines: {
            some: {
              orderItem: { is: { warehouseReservedQty: { gt: 0 } } },
            },
          },
        },
      ],
      createdAt: { lt: new Date(Date.now() - MIN_AGE_MS) },
      attemptCount: { lt: MAX_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      orderId: true,
      source: true,
      status: true,
      error: true,
      dispatchedAt: true,
    },
  });

  const summary: FiscalRetrySummary = {
    scanned: documents.length,
    retried: 0,
    issued: 0,
    skippedUnsafe: 0,
    failed: 0,
  };

  const retriedOrders = new Set<string>();
  for (const document of documents) {
    if (document.status === "ISSUED") {
      summary.retried += 1;
      try {
        // The provider already issued this receipt, so never dispatch it
        // again. The normal delivery flow detects the existing document,
        // completes its idempotent stock posting, and sends the email that
        // was skipped when the original stock posting failed.
        const result = await issueAndDeliverFiscalReceipt(document.orderId, {
          source: document.source === "REFUND" ? "MANUAL" : document.source,
          forceEmail: true,
        });
        if (result.outcome.ok) summary.issued += 1;
        else summary.failed += 1;
      } catch (err) {
        summary.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[fiscal:retry] ${document.id} stock posting failed: ${message}`);
      }
      continue;
    }
    if (isUnsafeFiscalRedispatch(document)) {
      summary.skippedUnsafe += 1;
      continue;
    }
    if (retriedOrders.has(document.orderId)) continue;
    retriedOrders.add(document.orderId);

    summary.retried += 1;
    try {
      const result = await issueAndDeliverFiscalReceipt(document.orderId, {
        source: document.source === "REFUND" ? "MANUAL" : document.source,
      });
      if (result.outcome.ok) {
        summary.issued += 1;
      } else {
        summary.failed += 1;
        console.error(
          `[fiscal:retry] ${document.id} order=${document.orderId} failed: ${result.outcome.error}`,
        );
      }
    } catch (err) {
      summary.failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[fiscal:retry] ${document.id} order=${document.orderId} threw: ${message}`);
    }
  }

  return summary;
}
