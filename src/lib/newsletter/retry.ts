import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Only explicit provider rejections are safe to retry. No error/message ID is
// not evidence that a request failed: delivery_unknown must remain untouched.
export function retryableNewsletterRecipientWhere(campaignId: string): Prisma.NewsletterCampaignRecipientWhereInput {
  return {
    campaignId, status: "FAILED", sentAt: null, providerMessageId: null,
    deliveredAt: null, openedAt: null, clickedAt: null, bouncedAt: null,
    complainedAt: null, unsubscribedAt: null,
    OR: [
      { failureReason: { startsWith: "ses:AccessDeniedException status=403 " } },
      ...["ACCOUNT_THROTTLED", "ACCOUNT_DAILY_QUOTA_EXCEEDED", "TRANSIENT_FAILURE", "MAIL_FROM_DOMAIN_NOT_VERIFIED", "CONFIGURATION_SET_DOES_NOT_EXIST"].map((code) => ({
        OR: [{ failureReason: `ses:${code}` }, { failureReason: { startsWith: `ses:${code} ` } }],
      })),
    ],
  };
}

export async function newsletterRetrySummary(campaignId: string) {
  const [queued, retryable, unknown] = await Promise.all([
    db.newsletterCampaignRecipient.count({ where: { campaignId, status: "QUEUED" } }),
    db.newsletterCampaignRecipient.count({ where: retryableNewsletterRecipientWhere(campaignId) }),
    db.newsletterCampaignRecipient.count({ where: { campaignId, status: "FAILED", failureReason: "ses:delivery_unknown" } }),
  ]);
  return { queued, retryable, unknown };
}

export async function retryNewsletterCampaign(campaignId: string, actorId: string) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const campaign = await tx.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (campaign.status !== "FAILED" && campaign.status !== "PARTIAL_FAILED") {
      throw new Error("Ponovno slanje je dozvoljeno samo za kampanju sa greškom.");
    }
    const total = await tx.newsletterCampaignRecipient.count({ where: { campaignId } });
    const claimed = await tx.newsletterCampaign.updateMany({
      where: { id: campaignId, status: campaign.status, updatedAt: campaign.updatedAt },
      // Resume the existing snapshot, including dynamic campaigns. PREPARING
      // would rebuild it and silently add new recipients during a retry.
      data: { status: total ? "SENDING" : "SCHEDULED", scheduledAt: now, failureReason: null, updatedById: actorId },
    });
    if (claimed.count !== 1) throw new Error("Kampanja je u međuvremenu promenjena. Osvežite stranicu.");
    const requeued = await tx.newsletterCampaignRecipient.updateMany({
      where: retryableNewsletterRecipientWhere(campaignId),
      data: { status: "QUEUED", failureReason: null },
    });
    const queued = await tx.newsletterCampaignRecipient.count({ where: { campaignId, status: "QUEUED" } });
    const unknown = await tx.newsletterCampaignRecipient.count({ where: { campaignId, status: "FAILED", failureReason: "ses:delivery_unknown" } });
    if (total && !queued && !campaign.providerBroadcastId) {
      throw new Error(unknown
        ? `Nema potvrđeno neposlatih poruka za ponovno slanje. Za ${unknown} poruka ishod nije poznat; prvo proverite SES evidenciju.`
        : "Nema poruka koje se mogu bezbedno ponoviti. Već prihvaćene, odjavljene i trajno odbijene adrese ostaju izostavljene.");
    }
    const idempotencyKey = `newsletter-send:${campaignId}`;
    const existing = await tx.backgroundJob.findUnique({ where: { idempotencyKey }, select: { id: true } });
    const job = {
      payload: { campaignId }, status: "QUEUED", attempts: 0, maxAttempts: 8,
      availableAt: now, lockedAt: null, completedAt: null, lastError: null,
    };
    if (existing) {
      const reset = await tx.backgroundJob.updateMany({
        where: { id: existing.id, status: { not: "RUNNING" } }, data: job,
      });
      if (reset.count !== 1) throw new Error("Slanje ove kampanje je već u obradi. Sačekajte završetak pa osvežite stranicu.");
    } else {
      await tx.backgroundJob.create({ data: { ...job, kind: "NEWSLETTER_CAMPAIGN_SEND", idempotencyKey } });
    }
    return { scheduledAt: now, requeued: requeued.count, queued, unknown, previousFailureReason: campaign.failureReason };
  });
}
