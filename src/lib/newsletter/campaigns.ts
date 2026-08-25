import "server-only";

import {
  NewsletterCampaignStatus,
  NewsletterRecipientStatus,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getEmailConfig } from "@/lib/email/config";
import { dispatchSesBulk } from "@/lib/email/ses";
import { trackedDispatch } from "@/lib/email/tracking";
import { buildEmailUnsubscribeUrl } from "@/lib/email/unsubscribe";
import { syncResendContact } from "@/lib/email/resend-marketing";
import { withdrawMarketingEmail } from "./contacts";
import {
  addResendContactToSegment,
  cancelResendBroadcast,
  createResendBroadcast,
  createResendSegment,
  getResendBroadcast,
  listResendSegmentContactEmails,
  removeResendContactFromSegment,
  sendResendBroadcast,
} from "@/lib/email/resend-broadcasts";
import {
  audienceFilterJson,
  combineNewsletterAudiences,
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
  audienceIds: z.array(z.string().min(1)).max(20).default([]),
  audienceMode: z.enum(["DYNAMIC", "FIXED"]).default("DYNAMIC"),
  includeContactsWithoutConsent: z.boolean().default(false),
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
  const audienceIds = Array.from(new Set(input.audienceIds));
  const audienceRows = audienceIds.length
    ? await db.newsletterAudience.findMany({ where: { id: { in: audienceIds } } })
    : [];
  if (audienceRows.length !== audienceIds.length) {
    throw new Error("Jedna od izabranih publika više ne postoji.");
  }
  const audienceById = new Map(audienceRows.map((audience) => [audience.id, audience]));
  const audiences = audienceIds.map((id) => audienceById.get(id)!);
  const audienceFilter = combineNewsletterAudiences(audiences);
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
        audienceId: audiences.length === 1 ? audiences[0]!.id : null,
        audienceMode: input.audienceMode,
        includeContactsWithoutConsent: input.includeContactsWithoutConsent,
        audienceFilterSnapshot: audienceFilterJson(audienceFilter),
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
        audienceFilter: audienceFilterJson(audienceFilter),
        includeContactsWithoutConsent: input.includeContactsWithoutConsent,
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
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { audience: true },
  });
  if (campaign.status !== "IN_REVIEW") throw new Error("Kampanja prvo mora da bude poslata na proveru.");
  const preflight = await preflightNewsletterCampaign(campaignId, false);
  if (preflight.errors.length) throw new Error(preflight.errors.join(" "));
  const count = preflight.recipientCount;
  if (count >= twoPersonThreshold() && campaign.createdById === actorId) {
    throw new Error(`Kampanju za ${count} primalaca mora da odobri drugi administrator.`);
  }
  return db.newsletterCampaign.update({
    where: { id: campaignId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedById: actorId,
      recipients: count,
      audienceBreakdown: preflight.breakdown,
    },
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
  const preflight = await preflightNewsletterCampaign(campaignId);
  if (preflight.errors.length) throw new Error(preflight.errors.join(" "));
  const filter = newsletterAudienceFilterSchema.parse(
    campaign.audienceFilterSnapshot ?? campaign.audience?.filter ?? emptyAudienceFilter(),
  );
  const resolved = await resolveNewsletterAudience(filter, {
    includeContactsWithoutConsent: campaign.includeContactsWithoutConsent,
  });
  if (requiresSecondApprover(campaign, resolved.recipients.length)) {
    await reopenCampaignReview(campaignId, resolved.recipients.length, resolved.breakdown);
    throw new Error(
      `Publika sada ima ${resolved.recipients.length} primalaca. Kampanju mora ponovo da odobri drugi administrator.`,
    );
  }
  if (campaign.audienceMode === "FIXED") {
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
      recipients: resolved.recipients.length,
      audienceBreakdown: resolved.breakdown,
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
  const cancelledAt = new Date();
  await db.$transaction(async (tx) => {
    const cancelled = await tx.newsletterCampaign.updateMany({
      where: { id: campaignId, status: { in: ["APPROVED", "SCHEDULED"] } },
      data: { status: "CANCELLED", cancelledAt, updatedById: actorId },
    });
    if (cancelled.count !== 1) {
      throw new Error("Kampanju je u međuvremenu preuzeo sistem za slanje i više ne može da se otkaže.");
    }
    await tx.backgroundJob.updateMany({
      where: {
        idempotencyKey: `newsletter-send:${campaignId}`,
        status: { in: ["QUEUED", "RETRY"] },
      },
      data: {
        status: "COMPLETED",
        payload: {},
        lockedAt: null,
        completedAt: cancelledAt,
        lastError: "campaign_cancelled",
      },
    });
  });
}

export async function retryNewsletterCampaign(campaignId: string, actorId: string) {
  const campaign = await db.newsletterCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (!["FAILED", "PARTIAL_FAILED"].includes(campaign.status)) {
    throw new Error("Ponovno slanje je dozvoljeno samo za kampanju sa greškom.");
  }
  const now = new Date();
  await db.$transaction([
    db.newsletterCampaign.update({
      where: { id: campaignId },
      data: {
        status: "SCHEDULED",
        scheduledAt: now,
        failureReason: null,
        updatedById: actorId,
      },
    }),
    db.backgroundJob.upsert({
      where: { idempotencyKey: `newsletter-send:${campaignId}` },
      create: {
        kind: "NEWSLETTER_CAMPAIGN_SEND",
        payload: { campaignId },
        idempotencyKey: `newsletter-send:${campaignId}`,
        maxAttempts: 8,
        availableAt: now,
      },
      update: {
        payload: { campaignId },
        status: "QUEUED",
        attempts: 0,
        maxAttempts: 8,
        availableAt: now,
        lockedAt: null,
        completedAt: null,
        lastError: null,
      },
    }),
  ]);
  return { scheduledAt: now };
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
      includeContactsWithoutConsent: source.includeContactsWithoutConsent,
      audienceFilterSnapshot: source.audienceFilterSnapshot as Prisma.InputJsonValue | undefined,
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
          includeContactsWithoutConsent: source.includeContactsWithoutConsent,
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
  if (!campaign.audienceId && !filter.selectedAudiences.length) {
    errors.push("Izaberite bar jednu publiku kampanje.");
  }
  const rendered = await renderNewsletterCampaign({
    subject: campaign.subject,
    previewText: campaign.previewText,
    content: campaign.content,
  });
  warnings.push(...rendered.warnings);
  const productWarnings = rendered.warnings.filter((warning) =>
    warning.includes("izostavljen"),
  );
  if (productWarnings.length) {
    errors.push(`Preflight proizvoda nije prošao: ${productWarnings.join(" ")}`);
  }
  if (!campaign.subject.trim()) errors.push("Naslov poruke je obavezan.");
  if (!rendered.blocks.length) errors.push("Kampanja nema sadržaj.");
  const resolved = await resolveNewsletterAudience(filter, {
    includeContactsWithoutConsent: campaign.includeContactsWithoutConsent,
  });
  if (resolved.breakdown.matchedWithoutConsent) {
    warnings.push(
      `Uključeno je ${resolved.breakdown.matchedWithoutConsent.toLocaleString("sr-Latn-RS")} kontakata bez zabeležene saglasnosti.`,
    );
  }
  if (!resolved.recipients.length) errors.push("Publika nema nijednog podobnog primaoca.");
  const cfg = getEmailConfig();
  if (requireProvider && process.env.NODE_ENV === "production") {
    if (cfg.provider === "ses") {
      if (!cfg.sesCredentialsConfigured) errors.push("Amazon SES pristup nije konfigurisan.");
      if (!cfg.sesRegion) errors.push("Amazon SES region nije konfigurisan.");
    } else if (cfg.provider === "resend") {
      if (!cfg.apiKey) errors.push("Resend nije konfigurisan.");
      if (!cfg.promotionsTopicId) errors.push("Resend promotions topic nije konfigurisan.");
    } else {
      errors.push("Produkcijski email provider nije konfigurisan.");
    }
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
  if (
    (campaign.audienceMode === "DYNAMIC" && campaign.status === "PREPARING") ||
    !(await db.newsletterCampaignRecipient.count({ where: { campaignId } }))
  ) {
    const resolved = await resolveNewsletterAudience(filter, {
      includeContactsWithoutConsent: campaign.includeContactsWithoutConsent,
    });
    await replaceCampaignRecipients(campaignId, resolved.recipients);
    await db.newsletterCampaign.update({
      where: { id: campaignId },
      data: { recipients: resolved.recipients.length, audienceBreakdown: resolved.breakdown },
    });
  }
  const cfg = getEmailConfig();
  const selectedRecipientCount = await db.newsletterCampaignRecipient.count({
    where: { campaignId },
  });
  if (requiresSecondApprover(campaign, selectedRecipientCount)) {
    await reopenCampaignReview(campaignId, selectedRecipientCount);
    return {
      ok: false as const,
      approvalRequired: true as const,
      recipients: selectedRecipientCount,
    };
  }
  const recipients = await finalEligibleRecipients(
    campaignId,
    campaign.includeContactsWithoutConsent,
    cfg.provider === "ses" ? sesNewsletterBatchSize() : undefined,
  );
  if (!recipients.length) {
    const queued = await db.newsletterCampaignRecipient.count({
      where: { campaignId, status: "QUEUED" },
    });
    if (cfg.provider === "ses" && queued) {
      await enqueueSesNewsletterContinuation(campaignId, `eligible-${queued}`);
      return {
        ok: true as const,
        partial: true as const,
        recipients: 0,
        remaining: queued,
      };
    }
    if (cfg.provider === "ses") {
      return finalizeSesNewsletterCampaign(campaignId);
    }
    throw new Error("Nema podobnih primalaca u trenutku slanja.");
  }
  const rendered = await renderNewsletterCampaign({
    subject: campaign.subject,
    previewText: campaign.previewText,
    content: campaign.content,
    unsubscribeUrl: cfg.provider === "ses" ? "{{unsubscribeUrl}}" : undefined,
  });
  const productWarnings = rendered.warnings.filter((warning) =>
    warning.includes("izostavljen"),
  );
  if (productWarnings.length) {
    throw new Error(`Preflight proizvoda nije prošao: ${productWarnings.join(" ")}`);
  }
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
  if (cfg.provider === "ses") {
    if (!cfg.sesCredentialsConfigured) {
      throw new Error("Amazon SES pristup nije konfigurisan.");
    }
    return sendSesNewsletterBatch({ campaign, recipients, rendered, cfg });
  }
  if (!cfg.apiKey) throw new Error("Email provider pristup nije konfigurisan.");
  if (cfg.provider !== "resend") throw new Error("Newsletter Broadcast slanje zahteva Resend provider.");
  if (!cfg.promotionsTopicId) throw new Error("RESEND_TOPIC_PROMOTIONS_ID nije konfigurisan.");

  // Resend plans cap the number of segments. A retry reuses its assigned
  // segment, and a new campaign can recycle a segment only after its previous
  // broadcast is fully sent. Always clear membership before repopulating it so
  // a changed dynamic audience can never inherit stale recipients.
  const segmentId = await prepareCleanCampaignSegment(campaign);
  const providerOptOuts: string[] = [];
  for (const recipient of recipients) {
    const withoutConsent = recipient.contact?.status === "PENDING";
    const sync = await syncResendContact({
      email: recipient.email,
      firstName: recipient.firstName,
      lastName: recipient.lastName,
      unsubscribed: false,
      promotionalAudience: true,
      subscriptionIntent: "preserve",
      preferenceScope: withoutConsent ? "global-only" : "promotions",
      source: "campaign",
    });
    if (!sync.ok) throw new Error(sync.error);
    if (sync.providerOptedOut) {
      providerOptOuts.push(recipient.email);
      await withdrawMarketingEmail(recipient.email, "resend-preference-reconciliation");
      continue;
    }
    await addResendContactToSegment(recipient.email, segmentId);
  }
  if (providerOptOuts.length) {
    await db.newsletterCampaignRecipient.updateMany({
      where: { campaignId, email: { in: providerOptOuts }, status: "QUEUED" },
      data: {
        status: "UNSUBSCRIBED",
        failureReason: "provider_preference_opt_out",
        unsubscribedAt: new Date(),
      },
    });
  }
  const providerEligibleCount = recipients.length - providerOptOuts.length;
  if (!providerEligibleCount) {
    throw new Error("Nema primalaca nakon usklađivanja provider odjava.");
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
    topicId: recipients.some((recipient) => recipient.contact?.status === "PENDING")
      ? null
      : cfg.promotionsTopicId,
  });
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: { providerBroadcastId: remote.id, status: "SENDING" },
  });
  await sendResendBroadcast(remote.id);
  await markCampaignAccepted(campaignId);
  return { ok: true as const, providerBroadcastId: remote.id, recipients: providerEligibleCount };
}

async function prepareCleanCampaignSegment(campaign: {
  id: string;
  title: string;
  providerSegmentId: string | null;
}) {
  let segmentId = await prepareCampaignSegment(campaign);
  let existingEmails: string[];
  try {
    existingEmails = await listResendSegmentContactEmails(segmentId);
  } catch (error) {
    if (!isMissingResendSegment(error)) throw error;
    await db.newsletterCampaign.updateMany({
      where: { id: campaign.id, providerSegmentId: segmentId },
      data: { providerSegmentId: null },
    });
    segmentId = await prepareCampaignSegment({ ...campaign, providerSegmentId: null });
    existingEmails = await listResendSegmentContactEmails(segmentId);
  }
  for (const email of existingEmails) {
    await removeResendContactFromSegment(email, segmentId);
  }
  return segmentId;
}

async function prepareCampaignSegment(campaign: {
  id: string;
  title: string;
  providerSegmentId: string | null;
}) {
  if (campaign.providerSegmentId) return campaign.providerSegmentId;
  try {
    const segment = await createResendSegment(
      `SPC ${campaign.id} ${campaign.title} ${Date.now()}`.slice(0, 120),
    );
    await db.newsletterCampaign.update({
      where: { id: campaign.id },
      data: { providerSegmentId: segment.id },
    });
    return segment.id;
  } catch (error) {
    if (!isResendSegmentLimit(error)) throw error;
  }

  const reusable = await db.newsletterCampaign.findMany({
    where: {
      id: { not: campaign.id },
      status: "SENT",
      providerSegmentId: { not: null },
      providerBroadcastId: { not: null },
    },
    orderBy: { sentAt: "asc" },
    take: 10,
    select: { id: true, providerSegmentId: true, providerBroadcastId: true },
  });
  for (const candidate of reusable) {
    if (!candidate.providerSegmentId || !candidate.providerBroadcastId) continue;
    const remote = await getResendBroadcast(candidate.providerBroadcastId).catch(() => null);
    if (remote?.status !== "sent") continue;
    const claimed = await db.$transaction(async (tx) => {
      const released = await tx.newsletterCampaign.updateMany({
        where: { id: candidate.id, providerSegmentId: candidate.providerSegmentId },
        data: { providerSegmentId: null },
      });
      if (released.count !== 1) return false;
      await tx.newsletterCampaign.update({
        where: { id: campaign.id },
        data: { providerSegmentId: candidate.providerSegmentId },
      });
      return true;
    });
    if (claimed) return candidate.providerSegmentId;
  }
  throw new Error(
    "Resend nema slobodan segment za kampanju. Sačekajte da se prethodno slanje potpuno završi ili povećajte plan.",
  );
}

function isResendSegmentLimit(error: unknown) {
  return error instanceof Error && (
    error.message.includes("plan includes") ||
    (error.message.includes("/segments") && error.message.includes("400"))
  );
}

function isMissingResendSegment(error: unknown) {
  return error instanceof Error &&
    error.message.includes("Resend GET /segments/") &&
    error.message.includes(": 404 ");
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
  const occurredAt = eventTime(event.data.created_at);
  const transition = newsletterRecipientTransition(event.data.type, recipient.status, occurredAt);
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
  const [recipients, delivered, opened, clicked, bounced, complained, unsubscribed, failed] =
    await Promise.all([
      db.newsletterCampaignRecipient.count({ where: { campaignId } }),
      db.newsletterCampaignRecipient.count({
        where: { campaignId, OR: [{ deliveredAt: { not: null } }, { openedAt: { not: null } }, { clickedAt: { not: null } }] },
      }),
      db.newsletterCampaignRecipient.count({
        where: { campaignId, OR: [{ openedAt: { not: null } }, { clickedAt: { not: null } }] },
      }),
      db.newsletterCampaignRecipient.count({ where: { campaignId, clickedAt: { not: null } } }),
      db.newsletterCampaignRecipient.count({ where: { campaignId, bouncedAt: { not: null } } }),
      db.newsletterCampaignRecipient.count({ where: { campaignId, complainedAt: { not: null } } }),
      db.newsletterCampaignRecipient.count({ where: { campaignId, unsubscribedAt: { not: null } } }),
      db.newsletterCampaignRecipient.count({
        where: {
          campaignId,
          OR: [{ status: "FAILED" }, { bouncedAt: { not: null } }, { complainedAt: { not: null } }],
        },
      }),
    ]);
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: {
      recipients,
      delivered,
      opened,
      clicked,
      bounced,
      complained,
      unsubscribed,
      failed,
    },
  });
}

async function replaceCampaignRecipients(
  campaignId: string,
  recipients: Array<{ id: string; email: string; firstName: string | null; lastName: string | null; language: string; status: "ACTIVE" | "PENDING" }>,
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
          consentStatusAtSelection: recipient.status,
        })),
        skipDuplicates: true,
      });
    }
  });
}

async function finalEligibleRecipients(
  campaignId: string,
  includeContactsWithoutConsent: boolean,
  limit?: number,
) {
  const rows = await db.newsletterCampaignRecipient.findMany({
    where: {
      campaignId,
      status: "QUEUED",
    },
    include: { contact: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    ...(limit ? { take: limit } : {}),
  });
  const isAllowedStatus = (status: string | undefined) =>
    status === "ACTIVE" || (includeContactsWithoutConsent && status === "PENDING");
  const inactive = rows.filter((row) => !isAllowedStatus(row.contact?.status));
  if (inactive.length) {
    await db.newsletterCampaignRecipient.updateMany({
      where: { id: { in: inactive.map((row) => row.id) } },
      data: {
        status: "UNSUBSCRIBED",
        failureReason: "not_eligible_before_send",
        unsubscribedAt: new Date(),
      },
    });
  }
  const active = rows.filter((row) => isAllowedStatus(row.contact?.status));
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

async function sendSesNewsletterBatch(args: {
  campaign: {
    id: string;
    subject: string;
    fromName: string | null;
    fromEmail: string | null;
    replyTo: string | null;
  };
  recipients: Awaited<ReturnType<typeof finalEligibleRecipients>>;
  rendered: Awaited<ReturnType<typeof renderNewsletterCampaign>>;
  cfg: ReturnType<typeof getEmailConfig>;
}) {
  await db.newsletterCampaign.update({
    where: { id: args.campaign.id },
    data: { status: "SENDING", failureReason: null },
  });

  const result = await dispatchSesBulk(
    {
      from: marketingSender(args.campaign, args.cfg.marketingFrom),
      replyTo: args.campaign.replyTo ?? args.cfg.replyTo,
      subject: args.campaign.subject,
      html: args.rendered.html,
      text: args.rendered.text,
      recipients: args.recipients.map((recipient) => ({
        email: recipient.email,
        templateData: {
          unsubscribeUrl: buildEmailUnsubscribeUrl({
            purpose: "newsletter",
            email: recipient.email,
          }),
        },
      })),
      tags: { kind: "newsletter", campaign: args.campaign.id },
    },
    {
      region: args.cfg.sesRegion,
      configurationSet: args.cfg.sesConfigurationSet,
    },
  );
  if (!result.ok) throw new Error(result.error);

  const recipientByEmail = new Map(
    args.recipients.map((recipient) => [recipient.email.toLowerCase(), recipient]),
  );
  const retryable: string[] = [];
  const now = new Date();
  await db.$transaction(
    result.results.map((providerResult) => {
      const recipient = recipientByEmail.get(providerResult.email.toLowerCase());
      if (!recipient) {
        throw new Error("Amazon SES je vratio rezultat za nepoznatog primaoca.");
      }
      if (providerResult.ok) {
        return db.newsletterCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "SENT",
            providerMessageId: providerResult.id,
            sentAt: now,
            failureReason: null,
          },
        });
      }
      if (isRetryableSesRecipientError(providerResult.error)) {
        retryable.push(providerResult.error ?? "ses:retryable_failure");
        return db.newsletterCampaignRecipient.update({
          where: { id: recipient.id },
          data: {
            status: "QUEUED",
            failureReason: (providerResult.error ?? "ses:retryable_failure").slice(0, 4_000),
          },
        });
      }
      return db.newsletterCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "FAILED",
          failureReason: (providerResult.error ?? "ses:permanent_failure").slice(0, 4_000),
        },
      });
    }),
  );

  await refreshCampaignStats(args.campaign.id);
  if (retryable.length) {
    throw new Error(
      `Amazon SES privremeno nije prihvatio ${retryable.length} poruka: ${retryable[0]}`,
    );
  }

  const remaining = await db.newsletterCampaignRecipient.count({
    where: { campaignId: args.campaign.id, status: "QUEUED" },
  });
  if (remaining) {
    await enqueueSesNewsletterContinuation(
      args.campaign.id,
      args.recipients.at(-1)?.id ?? `remaining-${remaining}`,
    );
    return {
      ok: true as const,
      partial: true as const,
      recipients: result.results.filter((item) => item.ok).length,
      remaining,
    };
  }

  return finalizeSesNewsletterCampaign(args.campaign.id);
}

async function enqueueSesNewsletterContinuation(campaignId: string, cursor: string) {
  const idempotencyKey = `newsletter-send:${campaignId}:after:${cursor}`.slice(0, 200);
  await db.backgroundJob.upsert({
    where: { idempotencyKey },
    create: {
      kind: "NEWSLETTER_CAMPAIGN_SEND",
      payload: { campaignId },
      idempotencyKey,
      maxAttempts: 8,
    },
    update: {},
  });
}

async function finalizeSesNewsletterCampaign(campaignId: string) {
  await refreshCampaignStats(campaignId);
  const [failed, accepted] = await Promise.all([
    db.newsletterCampaignRecipient.count({
      where: {
        campaignId,
        status: { in: ["FAILED", "BOUNCED", "COMPLAINED"] },
      },
    }),
    db.newsletterCampaignRecipient.count({
      where: {
        campaignId,
        status: { in: ["SENT", "DELIVERED", "OPENED", "CLICKED"] },
      },
    }),
  ]);
  const now = new Date();
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: {
      status: failed ? "PARTIAL_FAILED" : "SENT",
      sentAt: now,
      failureReason: failed ? `${failed} SES poruka nije prihvaćeno.` : null,
    },
  });
  return {
    ok: failed === 0,
    partial: failed > 0,
    recipients: accepted,
    failed,
  } as const;
}

function isRetryableSesRecipientError(error: string | null) {
  return Boolean(error && [
    "ACCOUNT_THROTTLED",
    "ACCOUNT_DAILY_QUOTA_EXCEEDED",
    "TRANSIENT_FAILURE",
  ].some((code) => error.includes(`ses:${code}`)));
}

function sesNewsletterBatchSize() {
  const value = Number.parseInt(process.env.SES_NEWSLETTER_BATCH_SIZE ?? "", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 50) : 50;
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
    created_at: z.string().optional(),
  }),
  created_at: z.string().optional(),
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
  if (rank[next.status] <= rank[current]) return null;
  return next;
}

export function requiresSecondApprover(
  campaign: { createdById: string | null; approvedById: string | null },
  recipientCount: number,
) {
  return recipientCount >= twoPersonThreshold() && campaign.createdById === campaign.approvedById;
}

async function reopenCampaignReview(
  campaignId: string,
  recipients: number,
  breakdown?: Prisma.InputJsonValue,
) {
  await db.newsletterCampaign.update({
    where: { id: campaignId },
    data: {
      status: "IN_REVIEW",
      approvedAt: null,
      approvedById: null,
      scheduledAt: null,
      recipients,
      ...(breakdown ? { audienceBreakdown: breakdown } : {}),
      failureReason: "Publika je prešla prag za obavezno odobrenje drugog administratora.",
    },
  });
}

function eventTime(value?: string) {
  const timestamp = value ? new Date(value) : new Date();
  return Number.isFinite(timestamp.getTime()) ? timestamp : new Date();
}
