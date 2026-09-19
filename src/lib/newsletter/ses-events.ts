import "server-only";
import { db } from "@/lib/db";
import { newsletterRecipientTransition, refreshCampaignStats } from "./campaigns";

/** SNS signatures and topic allowlisting are verified by the route before this call. */
export async function recordSesNewsletterEvent(
  type: string,
  messageId: string,
  mail?: { destination?: string[]; tags?: Record<string, string[]> },
) {
  const recipientId = mail?.tags?.recipient?.[0];
  const campaignId = mail?.tags?.campaign?.[0];
  const destinations = (mail?.destination ?? []).map((email) => email.trim().toLowerCase());
  const recipient = await db.newsletterCampaignRecipient.findFirst({
    where: {
      OR: [
        { providerMessageId: messageId },
        ...(recipientId && campaignId && destinations.length ? [{ id: recipientId, campaignId, email: { in: destinations } }] : []),
      ],
    },
  });
  if (!recipient) return;
  // An SNS event can arrive before SendBulkEmail returns, or after its response was lost.
  const current = recipient.status === "FAILED" && recipient.failureReason === "ses:delivery_unknown"
    ? "QUEUED" : recipient.status;
  const next = newsletterRecipientTransition(type, current);
  if (!next) return;
  await db.newsletterCampaignRecipient.updateMany({
    where: { id: recipient.id, status: recipient.status, failureReason: recipient.failureReason },
    data: {
      status: next.status,
      ...next.timestamp,
      providerMessageId: messageId,
      sentAt: recipient.sentAt ?? new Date(),
      failureReason: ["FAILED", "BOUNCED", "COMPLAINED"].includes(next.status) ? type : null,
    },
  });
  await refreshCampaignStats(recipient.campaignId);
}
