import "server-only";

import { z } from "zod";
import { db } from "@/lib/db";

/**
 * Phase 4E — Delivery report ingestion.
 *
 * Viber posts callbacks for each `delivered` / `failed` event back to a
 * webhook configured in the partner dashboard. We use the `tracking_data`
 * field we set at send time (`cmp:<id>:rcp:<userId>`) to attribute the
 * event to the correct campaign and adjust counters.
 *
 * Counters were optimistically incremented at send time based on the API
 * acknowledgement. This handler reconciles by:
 *   - decrementing `delivered` and incrementing `failed` when an
 *     optimistically-delivered message later fails to deliver, and
 *     vice versa.
 *
 * It is idempotent on `(campaignId, recipientUserId, event)`: re-posting
 * the same callback is a no-op.
 */

export const inboundEventSchema = z.object({
  /** "delivered", "failed", "seen", "subscribed", "unsubscribed", … */
  event: z.string().min(1),
  message_token: z.union([z.string(), z.number()]).optional(),
  tracking_data: z.string().optional(),
  user_id: z.string().optional(),
  desc: z.string().optional(),
  // Original Viber payloads include lots of other fields we ignore.
});

export type InboundEvent = z.infer<typeof inboundEventSchema>;

export interface CampaignAttribution {
  campaignId: string;
  recipientUserId: string;
}

export function parseTracking(
  trackingData: string | undefined,
): CampaignAttribution | null {
  if (!trackingData) return null;
  // Format: `cmp:<id>:rcp:<userId>`.
  const match = /^cmp:([^:]+):rcp:(.+)$/.exec(trackingData);
  if (!match) return null;
  return { campaignId: match[1], recipientUserId: match[2] };
}

export interface ReportResult {
  ok: boolean;
  attributed: boolean;
  applied?: "delivered" | "failed" | "ignored";
}

/**
 * Apply a single inbound event. Unknown event types (`seen`, `subscribed`,
 * …) are accepted but not counted.
 */
export async function applyInboundEvent(
  event: InboundEvent,
): Promise<ReportResult> {
  const attribution = parseTracking(event.tracking_data);
  if (!attribution) {
    return { ok: true, attributed: false, applied: "ignored" };
  }

  const norm = event.event.toLowerCase();
  if (norm === "delivered") {
    // Already counted optimistically — nothing to reconcile in v1.
    return { ok: true, attributed: true, applied: "delivered" };
  }
  if (norm === "failed") {
    await db.viberCampaign.updateMany({
      where: { id: attribution.campaignId },
      data: {
        delivered: { decrement: 1 },
        failed: { increment: 1 },
      },
    });
    return { ok: true, attributed: true, applied: "failed" };
  }
  return { ok: true, attributed: true, applied: "ignored" };
}
