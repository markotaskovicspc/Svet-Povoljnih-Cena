import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isStoredPhoneAllowed, parseAudienceFilter, storedPhoneRecipientId } from "./audience";
import { buildNthPayload } from "./nth";
import type { ViberConfig } from "./config";
import type { ViberMessage, ViberDispatchResult } from "./transport";

// Dedicated statuses keep these jobs out of the ordinary Vercel worker, which
// cannot send from the IP whitelisted by NTH. No schema migration is required.
export const NTH_JOB_KIND = "NTH_VIBER_OUTBOUND";
export async function queueNthMessage(msg: ViberMessage, cfg: ViberConfig): Promise<ViberDispatchResult> {
  let payload: ReturnType<typeof buildNthPayload>;
  try { payload = buildNthPayload(msg, cfg.sender); }
  catch { return { ok: false, provider: "nth", error: "nth:invalid_message" }; }
  const key = `nth:${createHash("sha256").update(msg.requestId ?? msg.trackingData ?? randomUUID()).digest("hex")}`;
  const job = await db.backgroundJob.upsert({
    where: { idempotencyKey: key }, update: {},
    create: { kind: NTH_JOB_KIND, payload: payload as Prisma.InputJsonValue, idempotencyKey: key, status: "VIBER_QUEUED", maxAttempts: 1 },
    select: { id: true, status: true },
  });
  if (["VIBER_FAILED", "VIBER_UNKNOWN"].includes(job.status)) return { ok: false, provider: "nth", error: "nth:previous_send_requires_review" };
  return { ok: true, provider: "nth", messageToken: `queued:${job.id}` };
}

export async function claimNthMessage() {
  const now = new Date();
  // Reclaim only the acknowledgement lease. The server's durable journal must
  // return its stored result for a reclaimed job, never submit it again.
  const candidates = await db.backgroundJob.findMany({
    where: { kind: NTH_JOB_KIND, OR: [
      { status: "VIBER_QUEUED" },
      { status: "VIBER_RUNNING", lockedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    ] }, orderBy: { createdAt: "asc" }, take: 10,
    select: { id: true, status: true, lockedAt: true, payload: true },
  });
  for (const candidate of candidates) {
    const payload = candidate.payload as Record<string, unknown>;
    const tracking = typeof payload.transactionId === "string" ? /^cmp:([^:]+):rcp:(.+)$/.exec(payload.transactionId) : null;
    if (tracking) {
      // Re-check marketing consent immediately before the outbound worker gets
      // the message. Deleting a campaign or withdrawing consent cancels its queue.
      const stored = tracking[2].startsWith("phone_");
      const [user, campaign] = await Promise.all([
        stored ? Promise.resolve(null) : db.user.findFirst({ where: { id: tracking[2], deletedAt: null, marketingConsent: { is: { viber: true } } }, select: { id: true } }),
        db.viberCampaign.findUnique({ where: { id: tracking[1] }, select: { status: true, audience: { select: { filter: true } } } }),
      ]);
      let allowed = Boolean(user);
      if (stored && campaign?.audience) {
        const phone = (payload.destinations as { phoneNumber?: string }[] | undefined)?.[0]?.phoneNumber;
        try { allowed = Boolean(phone && parseAudienceFilter(campaign.audience.filter).allStoredPhones && storedPhoneRecipientId(phone) === tracking[2]); } catch { allowed = false; }
        if (allowed && phone) allowed = await isStoredPhoneAllowed(phone);
      }
      if (!allowed || !campaign || !["SENDING", "SENT"].includes(campaign.status)) {
        await db.backgroundJob.updateMany({ where: { id: candidate.id, status: candidate.status, lockedAt: candidate.lockedAt }, data: { status: "VIBER_CANCELLED", completedAt: now, lockedAt: null, lastError: "consent_or_campaign_unavailable" } });
        continue;
      }
    }
    const claim = await db.backgroundJob.updateMany({
      where: { id: candidate.id, kind: NTH_JOB_KIND, status: candidate.status, lockedAt: candidate.lockedAt },
      data: { status: "VIBER_RUNNING", lockedAt: now, attempts: { increment: 1 } },
    });
    if (claim.count === 1) return { id: candidate.id, payload: candidate.payload };
  }
  return null;
}

export async function completeNthMessage(id: string, outcome: "accepted" | "failed" | "unknown", messageId?: string) {
  const status = { accepted: "VIBER_SENT", failed: "VIBER_FAILED", unknown: "VIBER_UNKNOWN" }[outcome];
  // No body, phone number or provider description is logged or stored in errors.
  await db.backgroundJob.updateMany({
    where: { id, kind: NTH_JOB_KIND, status: "VIBER_RUNNING" },
    data: { status, completedAt: new Date(), lockedAt: null, lastError: messageId ? `NTH:${messageId}` : outcome },
  });
}
