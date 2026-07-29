import "server-only";

import {
  NewsletterCampaignStatus,
  NewsletterRecipientStatus,
  Prisma,
} from "@generated/prisma-client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getEmailConfig } from "@/lib/email/config";
import { trackedDispatch } from "@/lib/email/tracking";
import { syncResendContact } from "@/lib/email/resend-marketing";
import {
  addResendContactToSegment,
  cancelResendBroadcast,
  createResendBroadcast,
  createResendSegment,
  getResendBroadcast,
  sendResendBroadcast,
} from "@/lib/email/resend-broadcasts";
import {
  audienceFilterJson,
  emptyAudienceFilter,
  newsletterAudienceFilterSchema,
  resolveNewsletterAudience,
} from "./audience";
import {
  defaultNewsletterContent,
  newsletterContentSchema,
  renderNewsletterCampaign,
} from "./content";

const editableStatuses = new Set<NewsletterCampaignStatus>(["DRAFT", "IN_REVIEW"]);
const twoPersonThreshold = () => {
  const value = Number.parseInt(process.env.NEWSLETTER_TWO_PERSON_APPROVAL_THRESHOLD ?? "1000", 10);
  return Number.isFinite(value) ? Math.max(1, value) : 1_000;
};

export const saveCampaignSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  subject: z.string().trim().min(1).max(200),
  previewText: z.string().trim().max(240).optional().default(""),
  fromName: z.string().trim().max(120).optional().default(""),
  fromEmail: z.union([z.literal(""), z.email()]).optional().default(""),
  replyTo: z.union([z.literal(""), z.email()]).optional().default(""),
  audienceId: z.string().optional().default(""),
  audienceMode: z.enum(["DYNAMIC", "FIXED"]).default("DYNAMIC"),
  topicKey: z.string().trim().min(1).max(60).default("promotions"),
  content: newsletterContentSchema,
});

export async function createNewsletterCampaign(actorId: string, templateId?: string | null) {
  const template = templateId
    ? await db.newsletterTemplate.findUnique({ where: { id: templateId } })
    : null;
  const count = await db.newsletterCampaign.count();
  const title = template ? `${template.name} — kopija` : `Nova kampanja ${count + 1}`;
  const subject = template?.subject ?? title;
  const content = template?.content ?? defaultNewsletterContent();
  const rendered = await renderNewsletterCampaign({
    subject,
    previewText: template?.previewText,
    content,
  });
  return db.newsletterCampaign.create({
    data: {
      title,
      subject,
      previewText: template?.previewText,
      body: rendered.text,
      content: content as Prisma.InputJsonValue,
      html: rendered.html,
      text: rendered.text,
      createdById: actorId,
      updatedById: actorId,
      versions: {
        create: {
          version: 1,
          subject,
          previewText: template?.previewText,
          content: content as Prisma.InputJsonValue,
          html: rendered.html,
          text: rendered.text,
          createdById: actorId,
        },
      },
    },
  });
}

export async function saveNewsletterCampaign(
  rawInput: z.input<typeof saveCampaignSchema>,
  actorId: string,
) {
  const input = saveCampaignSchema.parse(rawInput);
  const current = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: input.id } });
  if (!editableStatuses.has(current.status)) {
    throw new Error("Zakazana ili poslata kampanja ne može da se menja. Otkažite je ili napravite kopiju.");
  }
  const audience = input.audienceId
    ? await db.newsletterAudience.findUnique({ where: { id: input.audienceId } })
    : null;
  if (input.audienceId && !audience) throw new Error("Izabrana publika ne postoji.");
  const rendered = await renderNewsletterCampaign({
    subject: input.subject,
    previewText: input.previewText,
    content: input.content,
  });
  const version = await db.newsletterCampaignVersion.aggregate({
    where: { campaignId: input.id },
    _max: { version: true },
  });
  await db.$transaction([
    db.newsletterCampaign.update({
      where: { id: input.id },
      data: {
        title: input.title,
        subject: input.subject,
        previewText: input.previewText || null,
        body: rendered.text,
        content: input.content as Prisma.InputJsonValue,
        html: rendered.html,
        text: rendered.text,
        fromName: input.fromName || null,
        fromEmail: input.fromEmail || null,
        replyTo: input.replyTo || null,
        audienceId: audience?.id ?? null,
        audienceMode: input.audienceMode,
        topicKey: input.topicKey,
        status: current.status === "IN_REVIEW" ? "DRAFT" : current.status,
        approvedAt: null,
        approvedById: null,
        updatedById: actorId,
      },
    }),
    db.newsletterCampaignVersion.create({
      data: {
        campaignId: input.id,
        version: (version._max.version ?? 0) + 1,
        subject: input.subject,
        previewText: input.previewText || null,
        content: input.content as Prisma.InputJsonValue,
        html: rendered.html,
        text: rendered.text,
        audienceFilter: audience?.filter as Prisma.InputJsonValue | undefined,
        createdById: actorId,
      },
    }),
  ]);
  return { id: input.id, warnings: rendered.warnings };
}

export async function submitNewsletterCampaignForReview(campaignId: string, actorId: string) {
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { audience: true },
  });
  if (campaign.status !== "DRAFT") throw new Error("Samo nacrt može na proveru.");
  const preflight = await preflightNewsletterCampaign(campaign.id, false);
  if (preflight.errors.length) throw new Error(preflight.errors.join(" "));
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: {
      status: "IN_REVIEW",
      audienceFilterSnapshot: audienceFilterJson(preflight.filter),
      audienceBreakdown: preflight.breakdown as Prisma.InputJsonValue,
      recipients: preflight.recipientCount,
      updatedById: actorId,
    },
  });
  return preflight;
}

export async function approveNewsletterCampaign(campaignId: string, actorId: string) {
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.status !== "IN_REVIEW") throw new Error("Kampanja prvo mora da bude poslata na proveru.");
  const count = campaign.recipients ?? 0;
  if (count >= twoPersonThreshold() && campaign.createdById === actorId) {
    throw new Error(`Kampanju za ${count} primalaca mora da odobri drugi administrator.`);
  }
  return db.newsletterCampaign.update({
    where: { id: campaignId },
    data: { status: "APPROVED", approvedAt: new Date(), approvedById: actorId },
  });
}

export async function scheduleNewsletterCampaign(
  campaignId: string,
  scheduledAt: Date,
  actorId: string,
) {
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { audience: true },
  });
  if (campaign.status !== "APPROVED") throw new Error("Samo odobrena kampanja može da se zakaže.");
  if (scheduledAt.getTime() < Date.now() - 60_000) throw new Error("Vreme slanja je u prošlosti.");
  const filter = newsletterAudienceFilterSchema.parse(
    campaign.audienceFilterSnapshot ?? campaign.audience?.filter ?? emptyAudienceFilter(),
  );
  if (campaign.audienceMode === "FIXED") {
    const resolved = await resolveNewsletterAudience(filter);
    await replaceCampaignRecipients(campaignId, resolved.recipients);
  }
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: {
      status: "SCHEDULED",
      scheduledAt,
      cancelledAt: null,
      failureReason: null,
      updatedById: actorId,
    },
  });
  if (scheduledAt.getTime() <= Date.now() + 60_000) {
    await db.backgroundJob.upsert({
      where: { idempotencyKey: `newsletter-send:${campaignId}` },
      create: {
        kind: "NEWSLETTER_CAMPAIGN_SEND",
        payload: { campaignId },
        idempotencyKey: `newsletter-send:${campaignId}`,
        maxAttempts: 8,
        availableAt: scheduledAt,
      },
      update: { availableAt: scheduledAt },
    });
  }
  return { scheduledAt };
}

export async function cancelNewsletterCampaign(campaignId: string, actorId: string) {
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (!["APPROVED", "SCHEDULED"].includes(campaign.status)) {
    throw new Error("Kampanja više ne može da se otkaže.");
  }
  if (campaign.providerBroadcastId) {
    await cancelResendBroadcast(campaign.providerBroadcastId).catch((error) => {
      throw new Error(`Provider nije potvrdio otkazivanje: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: { status: "CANCELLED", cancelledAt: new Date(), updatedById: actorId },
  });
}

export async function duplicateNewsletterCampaign(campaignId: string, actorId: string) {
  const source = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  const rendered = await renderNewsletterCampaign({
    subject: source.subject,
    previewText: source.previewText,
    content: source.content,
  });
  return db.newsletterCampaign.create({
    data: {
      title: `${source.title} — kopija`,
      subject: source.subject,
      previewText: source.previewText,
      body: rendered.text,
      content: source.content as Prisma.InputJsonValue,
      html: rendered.html,
      text: rendered.text,
      fromName: source.fromName,
      fromEmail: source.fromEmail,
      replyTo: source.replyTo,
      audienceId: source.audienceId,
      audienceMode: source.audienceMode,
      topicKey: source.topicKey,
      createdById: actorId,
      updatedById: actorId,
      versions: {
        create: {
          version: 1,
          subject: source.subject,
          previewText: source.previewText,
          content: source.content as Prisma.InputJsonValue,
          html: rendered.html,
          text: rendered.text,
          audienceFilter: source.audienceFilterSnapshot as Prisma.InputJsonValue | undefined,
          createdById: actorId,
        },
      },
    },
  });
}

export async function saveCampaignAsTemplate(campaignId: string, name: string, actorId: string) {
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  return db.newsletterTemplate.create({
    data: {
      name: z.string().trim().min(1).max(160).parse(name),
      subject: campaign.subject,
      previewText: campaign.previewText,
      content: campaign.content as Prisma.InputJsonValue,
      html: campaign.html,
      text: campaign.text,
      createdById: actorId,
      updatedById: actorId,
    },
  });
}

export async function sendNewsletterCampaignTest(campaignId: string, emailRaw: string) {
  const email = z.email().parse(emailRaw.trim().toLowerCase());
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  const rendered = await renderNewsletterCampaign({
    subject: campaign.subject,
    previewText: campaign.previewText,
    content: campaign.content,
    unsubscribeUrl: "#test-poruka",
  });
  const cfg = getEmailConfig();
  const result = await trackedDispatch({
    kind: "newsletter_test",
    from: marketingSender(campaign, cfg.marketingFrom),
    to: email,
    subject: `[TEST] ${campaign.subject}`,
    html: rendered.html,
    text: rendered.text,
    replyTo: campaign.replyTo,
    tags: { kind: "newsletter_test", campaign: campaign.id },
    idempotencyKey: `newsletter-test:${campaign.id}:${email}:${Date.now()}`,
  });
  if (!result.ok) throw new Error(result.error);
  return result;
}

export async function preflightNewsletterCampaign(campaignId: string, requireProvider = true) {
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { audience: true },
  });
  const errors: string[] = [];
  const warnings: string[] = [];
  const filter = newsletterAudienceFilterSchema.parse(
    campaign.audienceFilterSnapshot ?? campaign.audience?.filter ?? emptyAudienceFilter(),
  );
  if (!campaign.audienceId) errors.push("Izaberite publiku kampanje.");
  const rendered = await renderNewsletterCampaign({
    subject: campaign.subject,
    previewText: campaign.previewText,
    content: campaign.content,
  });
  warnings.push(...rendered.warnings);
  if (!campaign.subject.trim()) errors.push("Naslov poruke je obavezan.");
  if (!rendered.blocks.length) errors.push("Kampanja nema sadržaj.");
  const resolved = await resolveNewsletterAudience(filter);
  if (!resolved.recipients.length) errors.push("Publika nema nijednog podobnog primaoca.");
  const cfg = getEmailConfig();
  if (requireProvider && process.env.NODE_ENV === "production") {
    if (cfg.provider !== "resend" || !cfg.apiKey) errors.push("Resend nije konfigurisan.");
    if (!cfg.promotionsTopicId) errors.push("Resend promotions topic nije konfigurisan.");
    if (!cfg.marketingFrom) errors.push("Marketing pošiljalac nije konfigurisan.");
  }
  return {
    errors,
    warnings,
    filter,
    breakdown: resolved.breakdown,
    recipientCount: resolved.recipients.length,
  };
}

export async function enqueueDueNewsletterCampaigns(now = new Date()) {
  const due = await db.newsletterCampaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: 10,
    select: { id: true },
  });
  if (!due.length) return 0;
  for (const campaign of due) {
    await db.backgroundJob.upsert({
      where: { idempotencyKey: `newsletter-send:${campaign.id}` },
      create: {
        kind: "NEWSLETTER_CAMPAIGN_SEND",
        payload: { campaignId: campaign.id },
        idempotencyKey: `newsletter-send:${campaign.id}`,
        maxAttempts: 8,
      },
      update: {},
    });
  }
  return due.length;
}

export async function sendNewsletterCampaign(campaignId: string) {
  let campaign = await db.newsletterCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { audience: true },
  });
  if (campaign.status === "SENT") return { ok: true as const, duplicate: true as const };
  if (!["SCHEDULED", "PREPARING", "SENDING", "PARTIAL_FAILED", "FAILED"].includes(campaign.status)) {
    throw new Error(`Kampanja u statusu ${campaign.status} nije spremna za slanje.`);
  }
  if (campaign.status === "SCHEDULED") {
    const claimed = await db.newsletterCampaign.updateMany({
      where: { id: campaignId, status: "SCHEDULED", scheduledAt: { lte: new Date() } },
      data: { status: "PREPARING", failureReason: null },
    });
    if (claimed.count !== 1) throw new Error("Kampanja još nije dospela ili ju je preuzeo drugi worker.");
  }
  campaign = await db.newsletterCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { audience: true },
  });

  if (campaign.providerBroadcastId) {
    const cfg = getEmailConfig();
    if (cfg.provider === "resend" && cfg.apiKey) {
      const remote = await getResendBroadcast(campaign.providerBroadcastId);
      if (remote.status === "sent" || remote.status === "queued") {
        await markCampaignAccepted(campaignId);
        return { ok: true as const, providerBroadcastId: campaign.providerBroadcastId };
      }
      if (remote.status === "draft") {
        await sendResendBroadcast(campaign.providerBroadcastId);
        await markCampaignAccepted(campaignId);
        return { ok: true as const, providerBroadcastId: campaign.providerBroadcastId };
      }
    }
  }

  const filter = newsletterAudienceFilterSchema.parse(
    campaign.audienceFilterSnapshot ?? campaign.audience?.filter ?? emptyAudienceFilter(),
  );
  if (campaign.audienceMode === "DYNAMIC" || !(await db.newsletterCampaignRecipient.count({ where: { campaignId } }))) {
    const resolved = await resolveNewsletterAudience(filter);
    await replaceCampaignRecipients(campaignId, resolved.recipients);
    await db.newsletterCampaign.update({
      where: { id: campaignId },
      data: { recipients: resolved.recipients.length, audienceBreakdown: resolved.breakdown },
    });
  }
  const recipients = await finalEligibleRecipients(campaignId);
  if (!recipients.length) throw new Error("Nema podobnih primalaca u trenutku slanja.");
  const rendered = await renderNewsletterCampaign({
    subject: campaign.subject,
    previewText: campaign.previewText,
    content: campaign.content,
  });
  if (rendered.warnings.some((warning) => warning.includes("izostavljen"))) {
    throw new Error(`Preflight proizvoda nije prošao: ${rendered.warnings.join(" ")}`);
  }
  const cfg = getEmailConfig();
  if (cfg.provider === "none") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_PROVIDER=none nije dozvoljen za production newsletter slanje.");
    }
    await db.$transaction([
      db.newsletterCampaignRecipient.updateMany({
        where: { campaignId, email: { in: recipients.map((row) => row.email) } },
        data: { status: "DELIVERED", sentAt: new Date(), deliveredAt: new Date() },
      }),
      db.newsletterCampaign.update({
        where: { id: campaignId },
        data: { status: "SENT", sentAt: new Date(), delivered: recipients.length, failed: 0 },
      }),
    ]);
    return { ok: true as const, simulated: true as const, recipients: recipients.length };
  }
  if (!cfg.apiKey) throw new Error("Resend API ključ nije konfigurisan.");
  if (cfg.provider !== "resend") throw new Error("Newsletter Broadcast slanje zahteva Resend provider.");
  if (!cfg.promotionsTopicId) throw new Error("RESEND_TOPIC_PROMOTIONS_ID nije konfigurisan.");

  let segmentId = campaign.providerSegmentId;
  if (!segmentId) {
    const segment = await createResendSegment(`SPC ${campaign.id} ${campaign.title}`.slice(0, 120));
    segmentId = segment.id;
    await db.newsletterCampaign.update({ where: { id: campaignId }, data: { providerSegmentId: segmentId } });
  }
  for (let start = 0; start < recipients.length; start += 10) {
    const batch = recipients.slice(start, start + 10);
    await Promise.all(batch.map(async (recipient) => {
      const sync = await syncResendContact({
        email: recipient.email,
        firstName: recipient.firstName,
        lastName: recipient.lastName,
        userId: recipient.contact?.userId ?? undefined,
        unsubscribed: false,
        promotionalAudience: true,
        source: "campaign",
      });
      if (!sync.ok) throw new Error(sync.error);
      await addResendContactToSegment(recipient.email, segmentId!);
    }));
  }
  const remote = await createResendBroadcast({
    name: campaign.title,
    segmentId,
    subject: campaign.subject,
    previewText: campaign.previewText,
    html: rendered.html,
    text: rendered.text,
    from: marketingSender(campaign, cfg.marketingFrom),
    replyTo: campaign.replyTo ?? cfg.replyTo,
    topicId: cfg.promotionsTopicId,
  });
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: { providerBroadcastId: remote.id, status: "SENDING" },
  });
  await sendResendBroadcast(remote.id);
  await markCampaignAccepted(campaignId);
  return { ok: true as const, providerBroadcastId: remote.id, recipients: recipients.length };
}

export async function failNewsletterCampaign(campaignId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db.newsletterCampaign.updateMany({
    where: {
      id: campaignId,
      status: { in: ["SCHEDULED", "PREPARING", "SENDING", "PARTIAL_FAILED", "FAILED"] },
    },
    data: { status: "FAILED", failureReason: message.slice(0, 4_000) },
  });
}

export async function recordNewsletterProviderEvent(payload: unknown) {
  const event = webhookSchema.safeParse(payload);
  if (!event.success) return { matched: false as const };
  const broadcastId = event.data.data.broadcast_id;
  const email = firstEmail(event.data.data.to);
  if (!broadcastId || !email) return { matched: false as const };
  const campaign = await db.newsletterCampaign.findUnique({
    where: { providerBroadcastId: broadcastId },
    select: { id: true },
  });
  if (!campaign) return { matched: false as const };
  const recipient = await db.newsletterCampaignRecipient.findUnique({
    where: { campaignId_email: { campaignId: campaign.id, email } },
  });
  if (!recipient) return { matched: false as const };
  const transition = newsletterRecipientTransition(event.data.type, recipient.status);
  if (transition) {
    await db.newsletterCampaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: transition.status,
        providerMessageId: event.data.data.email_id ?? recipient.providerMessageId,
        ...transition.timestamp,
      },
    });
  }
  await refreshCampaignStats(campaign.id);
  return { matched: true as const, campaignId: campaign.id };
}

export async function refreshCampaignStats(campaignId: string) {
  const grouped = await db.newsletterCampaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const count = (statuses: NewsletterRecipientStatus[]) => grouped
    .filter((row) => statuses.includes(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: {
      recipients: grouped.reduce((sum, row) => sum + row._count._all, 0),
      delivered: count(["DELIVERED", "OPENED", "CLICKED"]),
      opened: count(["OPENED", "CLICKED"]),
      clicked: count(["CLICKED"]),
      bounced: count(["BOUNCED"]),
      complained: count(["COMPLAINED"]),
      unsubscribed: count(["UNSUBSCRIBED"]),
      failed: count(["FAILED", "BOUNCED", "COMPLAINED"]),
    },
  });
}

async function replaceCampaignRecipients(
  campaignId: string,
  recipients: Array<{ id: string; email: string; firstName: string | null; lastName: string | null; language: string }>,
) {
  await db.$transaction(async (tx) => {
    await tx.newsletterCampaignRecipient.deleteMany({ where: { campaignId, status: "QUEUED" } });
    if (recipients.length) {
      await tx.newsletterCampaignRecipient.createMany({
        data: recipients.map((recipient) => ({
          campaignId,
          contactId: recipient.id,
          email: recipient.email,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          language: recipient.language,
        })),
        skipDuplicates: true,
      });
    }
  });
}

async function finalEligibleRecipients(campaignId: string) {
  const rows = await db.newsletterCampaignRecipient.findMany({
    where: {
      campaignId,
      status: "QUEUED",
    },
    include: { contact: true },
  });
  const inactive = rows.filter((row) => row.contact?.status !== "ACTIVE");
  if (inactive.length) {
    await db.newsletterCampaignRecipient.updateMany({
      where: { id: { in: inactive.map((row) => row.id) } },
      data: {
        status: "UNSUBSCRIBED",
        failureReason: "not_active_before_send",
        unsubscribedAt: new Date(),
      },
    });
  }
  const active = rows.filter((row) => row.contact?.status === "ACTIVE");
  const suppressed = new Set((await db.emailSuppression.findMany({
    where: { email: { in: active.map((row) => row.email) } },
    select: { email: true },
  })).map((row) => row.email.toLowerCase()));
  const eligible = active.filter((row) => !suppressed.has(row.email.toLowerCase()));
  const excluded = active.filter((row) => suppressed.has(row.email.toLowerCase()));
  if (excluded.length) {
    await db.newsletterCampaignRecipient.updateMany({
      where: { id: { in: excluded.map((row) => row.id) } },
      data: { status: "FAILED", failureReason: "suppressed_before_send" },
    });
  }
  return eligible;
}

async function markCampaignAccepted(campaignId: string) {
  const now = new Date();
  await db.$transaction([
    db.newsletterCampaignRecipient.updateMany({
      where: { campaignId, status: "QUEUED" },
      data: { status: "SENT", sentAt: now },
    }),
    db.newsletterCampaign.update({
      where: { id: campaignId },
      data: { status: "SENT", sentAt: now, failureReason: null },
    }),
  ]);
}

function marketingSender(
  campaign: { fromName: string | null; fromEmail: string | null },
  fallback: string,
) {
  if (!campaign.fromEmail) return fallback;
  return campaign.fromName ? `${campaign.fromName} <${campaign.fromEmail}>` : campaign.fromEmail;
}

const webhookSchema = z.object({
  type: z.string(),
  data: z.object({
    broadcast_id: z.string().optional(),
    email_id: z.string().optional(),
    to: z.union([z.string(), z.array(z.string())]).optional(),
  }),
});

function firstEmail(value?: string | string[]) {
  const email = Array.isArray(value) ? value[0] : value;
  return email?.trim().toLowerCase() ?? null;
}

export function newsletterRecipientTransition(
  type: string,
  current: NewsletterRecipientStatus,
  now = new Date(),
) {
  const rank: Record<NewsletterRecipientStatus, number> = {
    QUEUED: 0, SENT: 1, DELIVERED: 2, OPENED: 3, CLICKED: 4,
    BOUNCED: 10, COMPLAINED: 11, FAILED: 9, UNSUBSCRIBED: 12,
  };
  const mapping: Record<string, { status: NewsletterRecipientStatus; timestamp: Record<string, Date> }> = {
    "email.sent": { status: "SENT", timestamp: { sentAt: now } },
    "email.delivered": { status: "DELIVERED", timestamp: { deliveredAt: now } },
    "email.opened": { status: "OPENED", timestamp: { openedAt: now } },
    "email.clicked": { status: "CLICKED", timestamp: { clickedAt: now } },
    "email.bounced": { status: "BOUNCED", timestamp: { bouncedAt: now } },
    "email.complained": { status: "COMPLAINED", timestamp: { complainedAt: now } },
    "email.failed": { status: "FAILED", timestamp: {} },
    "email.suppressed": { status: "FAILED", timestamp: {} },
  };
  const next = mapping[type];
  if (!next) return null;
  if (rank[current] >= 9 && rank[next.status] < 9) return null;
  if (rank[next.status] < rank[current]) return null;
  return next;
}
