import "server-only";

import { z } from "zod";
import { CampaignStatus, Prisma, type ViberCampaign } from "@prisma/client";
import { db } from "@/lib/db";
import { dispatch, type ViberDispatchResult } from "./transport";
import {
  audienceFilterSchema,
  parseAudienceFilter,
  resolveAudience,
} from "./audience";

/**
 * Phase 4E — Campaign composer + sender.
 *
 * Drafts are persisted as `ViberCampaign` rows (status DRAFT/SCHEDULED).
 * `sendCampaign` walks the resolved audience, dispatches one message per
 * recipient, and tallies delivered/failed counters that the admin
 * dashboard reads back. Concurrency is bounded so we don't open hundreds
 * of sockets to the provider in parallel.
 */

export const campaignDraftSchema = z.object({
  audienceId: z.string().min(1),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(900),
  imageUrl: z.string().url().optional().nullable(),
  ctaLabel: z.string().min(1).max(60).optional().nullable(),
  ctaUrl: z.string().url().optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
});

export type CampaignDraftInput = z.infer<typeof campaignDraftSchema>;

export const audienceDraftSchema = z.object({
  name: z.string().min(1).max(120),
  filter: audienceFilterSchema,
});

export type AudienceDraftInput = z.infer<typeof audienceDraftSchema>;

/** Persist (or replace) a saved audience query. */
export async function saveAudience(input: AudienceDraftInput, id?: string) {
  if (id) {
    return db.viberAudienceQuery.update({
      where: { id },
      data: { name: input.name, filter: input.filter as Prisma.InputJsonValue },
    });
  }
  return db.viberAudienceQuery.create({
    data: { name: input.name, filter: input.filter as Prisma.InputJsonValue },
  });
}

/** Persist a draft campaign. */
export async function saveCampaign(input: CampaignDraftInput, id?: string) {
  const data = {
    audienceId: input.audienceId,
    title: input.title,
    body: input.body,
    imageUrl: input.imageUrl ?? null,
    ctaLabel: input.ctaLabel ?? null,
    ctaUrl: input.ctaUrl ?? null,
    scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
    status: input.scheduledAt ? CampaignStatus.SCHEDULED : CampaignStatus.DRAFT,
  };
  if (id) {
    return db.viberCampaign.update({ where: { id }, data });
  }
  return db.viberCampaign.create({ data });
}

export interface SendOptions {
  /** Bounded concurrency (defaults to 8). */
  concurrency?: number;
  /** When true, resolve the audience and tally without dispatching. */
  dryRun?: boolean;
}

export interface SendReport {
  campaignId: string;
  status: CampaignStatus;
  recipients: number;
  delivered: number;
  failed: number;
  /** First few errors for debugging — capped at 10. */
  errors: string[];
}

/**
 * Send a campaign. Idempotency: campaigns in SENT or SENDING state are
 * not re-sent (callers must explicitly clone instead). Tracking-data is
 * `cmp:<id>:rcp:<userId>` so delivery webhooks can attribute results.
 */
export async function sendCampaign(
  campaignId: string,
  opts: SendOptions = {},
): Promise<SendReport> {
  const campaign = await db.viberCampaign.findUnique({
    where: { id: campaignId },
    include: { audience: true },
  });
  if (!campaign) throw new Error(`Kampanja ${campaignId} ne postoji.`);
  if (
    campaign.status === CampaignStatus.SENT ||
    campaign.status === CampaignStatus.SENDING
  ) {
    return {
      campaignId,
      status: campaign.status,
      recipients: campaign.recipients ?? 0,
      delivered: campaign.delivered ?? 0,
      failed: campaign.failed ?? 0,
      errors: [],
    };
  }

  const filter = parseAudienceFilter(campaign.audience.filter);
  const recipients = await resolveAudience(filter);

  if (opts.dryRun) {
    return {
      campaignId,
      status: campaign.status,
      recipients: recipients.length,
      delivered: 0,
      failed: 0,
      errors: [],
    };
  }

  await db.viberCampaign.update({
    where: { id: campaignId },
    data: {
      status: CampaignStatus.SENDING,
      recipients: recipients.length,
      delivered: 0,
      failed: 0,
    },
  });

  // Capture into locals so TS narrows inside the worker closure.
  const cmpId = campaign.id;
  const campaignBody = campaign.body;
  const campaignImage = campaign.imageUrl;
  const cta =
    campaign.ctaLabel && campaign.ctaUrl
      ? { label: campaign.ctaLabel, url: campaign.ctaUrl }
      : null;

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 8, 32));
  let cursor = 0;
  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= recipients.length) return;
      const r = recipients[idx];
      const result: ViberDispatchResult = await dispatch({
        to: r.phone,
        text: renderBody(campaignBody, r.displayName),
        imageUrl: campaignImage,
        cta,
        trackingData: `cmp:${cmpId}:rcp:${r.userId}`,
      });
      if (result.ok) delivered++;
      else {
        failed++;
        if (errors.length < 10) errors.push(`${r.phone}: ${result.error}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const updated = await db.viberCampaign.update({
    where: { id: campaignId },
    data: {
      status: CampaignStatus.SENT,
      sentAt: new Date(),
      delivered,
      failed,
    },
  });

  return {
    campaignId,
    status: updated.status,
    recipients: recipients.length,
    delivered,
    failed,
    errors,
  };
}

/**
 * Lightweight templating: replaces `{ime}` with the recipient's display
 * name. Kept intentionally minimal — anything richer should live in the
 * admin composer rather than the runtime.
 */
function renderBody(body: string, displayName: string): string {
  return body.replace(/\{ime\}/g, displayName);
}

/** Mark a campaign as failed (called from cron or manual admin action). */
export async function failCampaign(
  campaignId: string,
  reason: string,
): Promise<ViberCampaign> {
  // `reason` is logged so downstream observers (Sentry, audit log) can pick
  // it up; we don't yet persist it on `ViberCampaign` itself.
  console.warn(`[viber] campaign ${campaignId} failed: ${reason}`);
  return db.viberCampaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.FAILED, sentAt: new Date() },
  });
}

/**
 * Pick the next due scheduled campaign and send it. Intended to be
 * invoked by `/api/cron` on a 5-minute schedule.
 */
export async function runDueCampaigns(now = new Date()): Promise<SendReport[]> {
  const due = await db.viberCampaign.findMany({
    where: {
      status: CampaignStatus.SCHEDULED,
      scheduledAt: { lte: now },
    },
    orderBy: { scheduledAt: "asc" },
    take: 5,
  });
  const reports: SendReport[] = [];
  for (const c of due) {
    try {
      reports.push(await sendCampaign(c.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failCampaign(c.id, message);
      reports.push({
        campaignId: c.id,
        status: CampaignStatus.FAILED,
        recipients: 0,
        delivered: 0,
        failed: 0,
        errors: [message],
      });
    }
  }
  return reports;
}
