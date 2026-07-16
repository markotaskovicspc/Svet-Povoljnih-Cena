import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
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
  duplicate?: boolean;
}

export function getInboundEventId(event: InboundEvent, suppliedId?: string | null) {
  if (suppliedId?.trim()) return suppliedId.trim();

  return createHash("sha256")
    .update(
      [
        String(event.message_token ?? ""),
        event.event.toLowerCase(),
        event.tracking_data ?? "",
        event.user_id ?? "",
      ].join("\u001f"),
    )
    .digest("hex");
}

/**
 * Apply a single inbound event. Unknown event types (`seen`, `subscribed`,
 * …) are accepted but not counted.
 */
export async function applyInboundEvent(
  event: InboundEvent,
  suppliedEventId?: string | null,
): Promise<ReportResult> {
  const attribution = parseTracking(event.tracking_data);
  const norm = event.event.toLowerCase();
  const eventId = getInboundEventId(event, suppliedEventId);

  try {
    return await db.$transaction(async (tx) => {
      const stored = await tx.viberWebhookEvent.create({
        data: {
          eventId,
          event: norm,
          messageToken:
            event.message_token === undefined
              ? null
              : String(event.message_token),
          campaignId: attribution?.campaignId ?? null,
          recipientUserId: attribution?.recipientUserId ?? null,
          payload: event as Prisma.InputJsonValue,
        },
      });

      let applied: ReportResult["applied"] = "ignored";
      if (attribution && norm === "delivered") {
        // The transport counts accepted sends optimistically. Delivery is
        // persisted for reporting but does not change the counter again.
        applied = "delivered";
      } else if (attribution && norm === "failed") {
        const reconciled = await tx.viberCampaign.updateMany({
          where: {
            id: attribution.campaignId,
            delivered: { gt: 0 },
          },
          data: {
            delivered: { decrement: 1 },
            failed: { increment: 1 },
          },
        });
        if (reconciled.count === 0) {
          await tx.viberCampaign.updateMany({
            where: { id: attribution.campaignId },
            data: { failed: { increment: 1 } },
          });
        }
        applied = "failed";
      }

      await tx.viberWebhookEvent.update({
        where: { id: stored.id },
        data: { appliedAt: new Date() },
      });

      return {
        ok: true,
        attributed: Boolean(attribution),
        applied,
        duplicate: false,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        ok: true,
        attributed: Boolean(attribution),
        applied: "ignored",
        duplicate: true,
      };
    }
    throw error;
  }
}
