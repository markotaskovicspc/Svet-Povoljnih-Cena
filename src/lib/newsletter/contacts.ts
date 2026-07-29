import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getEmailConfig } from "@/lib/email/config";
import { trackedDispatch } from "@/lib/email/tracking";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { BRAND } from "@/lib/brand";

export const NEWSLETTER_CONSENT_VERSION = "newsletter-v2-2026-07";
export const NEWSLETTER_POLICY_VERSION = "privacy-2026-07";
const OPT_IN_TTL_MS = 24 * 60 * 60 * 1_000;

const emailSchema = z.email().transform((value) => value.trim().toLowerCase());

export async function requestNewsletterOptIn(input: {
  email: string;
  source?: string | null;
  evidence?: Record<string, string | null | undefined>;
}) {
  const email = emailSchema.parse(input.email);
  const source = cleanSource(input.source);
  const existing = await db.marketingContact.findUnique({ where: { email } });
  if (existing?.status === "SUPPRESSED") {
    return { ok: true as const, status: "suppressed" as const };
  }
  if (existing?.status === "ACTIVE") {
    await syncMarketingContact(email);
    return { ok: true as const, status: "active" as const };
  }

  const contact = await db.$transaction(async (tx) => {
    const row = await tx.marketingContact.upsert({
      where: { email },
      create: {
        email,
        status: "PENDING",
        source,
        consentVersion: NEWSLETTER_CONSENT_VERSION,
      },
      update: {
        status: "PENDING",
        source,
        consentVersion: NEWSLETTER_CONSENT_VERSION,
        unsubscribedAt: null,
      },
    });
    await tx.newsletterSubscriber.upsert({
      where: { email },
      create: { email, source, consent: false },
      update: { source, consent: false, unsubscribedAt: null },
    });
    await tx.marketingConsentEvent.create({
      data: {
        contactId: row.id,
        type: "REQUESTED",
        source,
        consentVersion: NEWSLETTER_CONSENT_VERSION,
        policyVersion: NEWSLETTER_POLICY_VERSION,
        evidence: pruneEvidence(input.evidence),
      },
    });
    await tx.newsletterOptInToken.deleteMany({
      where: { contactId: row.id, usedAt: null },
    });
    return row;
  });

  const token = randomBytes(32).toString("base64url");
  await db.newsletterOptInToken.create({
    data: {
      contactId: contact.id,
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + OPT_IN_TTL_MS),
    },
  });
  const result = await sendNewsletterOptInEmail({ email, token });
  if (!result.ok) throw new Error(result.error);
  return { ok: true as const, status: "pending" as const };
}

export async function confirmNewsletterOptIn(token: string) {
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(token)) {
    return { ok: false as const, reason: "invalid" as const };
  }
  return db.$transaction(async (tx) => {
    const row = await tx.newsletterOptInToken.findUnique({
      where: { tokenHash: digest(token) },
      include: { contact: true },
    });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      return { ok: false as const, reason: row?.expiresAt && row.expiresAt < new Date() ? "expired" as const : "invalid" as const };
    }
    const claimed = await tx.newsletterOptInToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gte: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return { ok: false as const, reason: "invalid" as const };
    if (row.contact.status === "SUPPRESSED") {
      return { ok: false as const, reason: "suppressed" as const };
    }
    const now = new Date();
    await tx.marketingContact.update({
      where: { id: row.contactId },
      data: {
        status: "ACTIVE",
        subscribedAt: now,
        confirmedAt: now,
        unsubscribedAt: null,
        consentVersion: NEWSLETTER_CONSENT_VERSION,
      },
    });
    await tx.newsletterSubscriber.upsert({
      where: { email: row.contact.email },
      create: { email: row.contact.email, source: row.contact.source, consent: true },
      update: { consent: true, unsubscribedAt: null },
    });
    await tx.marketingConsentEvent.create({
      data: {
        contactId: row.contactId,
        type: "CONFIRMED",
        source: row.contact.source ?? "newsletter",
        consentVersion: NEWSLETTER_CONSENT_VERSION,
        policyVersion: NEWSLETTER_POLICY_VERSION,
      },
    });
    return { ok: true as const, email: row.contact.email };
  }).then(async (result) => {
    if (result.ok) await syncMarketingContact(result.email);
    return result;
  });
}

export async function syncAccountMarketingContact(userId: string, optedIn: boolean) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      deletedAt: true,
      firstName: true,
      lastName: true,
      language: true,
    },
  });
  if (!user?.email || user.deletedAt) return null;
  const email = emailSchema.parse(user.email);
  const suppression = await db.emailSuppression.findUnique({ where: { email } });
  const status = suppression
    ? "SUPPRESSED" as const
    : optedIn && user.emailVerified
      ? "ACTIVE" as const
      : optedIn
        ? "PENDING" as const
        : "UNSUBSCRIBED" as const;
  const now = new Date();
  const contact = await db.marketingContact.upsert({
    where: { email },
    create: {
      email,
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      language: user.language,
      status,
      source: "account",
      consentVersion: NEWSLETTER_CONSENT_VERSION,
      subscribedAt: status === "ACTIVE" ? now : null,
      confirmedAt: status === "ACTIVE" ? now : null,
      unsubscribedAt: status === "UNSUBSCRIBED" ? now : null,
      suppressedAt: status === "SUPPRESSED" ? suppression?.createdAt : null,
    },
    update: {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      language: user.language,
      status,
      source: "account",
      consentVersion: NEWSLETTER_CONSENT_VERSION,
      ...(status === "ACTIVE" ? { subscribedAt: now, confirmedAt: now, unsubscribedAt: null } : {}),
      ...(status === "UNSUBSCRIBED" ? { unsubscribedAt: now } : {}),
      ...(status === "SUPPRESSED" ? { suppressedAt: suppression?.createdAt ?? now } : {}),
    },
  });
  await db.marketingConsentEvent.create({
    data: {
      contactId: contact.id,
      type: status === "ACTIVE" ? "GRANTED" : optedIn ? "REQUESTED" : "WITHDRAWN",
      source: "account",
      consentVersion: NEWSLETTER_CONSENT_VERSION,
      policyVersion: NEWSLETTER_POLICY_VERSION,
      evidence: { emailVerified: Boolean(user.emailVerified) },
    },
  });
  if (status === "ACTIVE") {
    await db.newsletterSubscriber.upsert({
      where: { email },
      create: { email, source: "account", consent: true },
      update: { consent: true, unsubscribedAt: null },
    });
  } else if (!optedIn) {
    await db.newsletterSubscriber.updateMany({
      where: { email },
      data: { consent: false, unsubscribedAt: now },
    });
  }
  await syncMarketingContact(email);
  return contact;
}

export async function confirmAccountMarketingContact(userId: string) {
  const consent = await db.marketingConsent.findUnique({ where: { userId } });
  if (!consent?.email) return null;
  return syncAccountMarketingContact(userId, true);
}

export async function withdrawMarketingEmail(emailRaw: string, source: string) {
  const email = emailSchema.parse(emailRaw);
  const contact = await db.marketingContact.findUnique({ where: { email } });
  const now = new Date();
  if (contact && contact.status !== "SUPPRESSED") {
    await db.$transaction([
      db.marketingContact.update({
        where: { id: contact.id },
        data: { status: "UNSUBSCRIBED", unsubscribedAt: now },
      }),
      db.marketingConsentEvent.create({
        data: { contactId: contact.id, type: "WITHDRAWN", source },
      }),
    ]);
  }
  await db.newsletterSubscriber.updateMany({
    where: { email },
    data: { consent: false, unsubscribedAt: now },
  });
  await syncMarketingContact(email);
}

export async function suppressMarketingEmail(emailRaw: string, reason: string, provider?: string | null) {
  const email = emailSchema.parse(emailRaw);
  const now = new Date();
  const contact = await db.marketingContact.upsert({
    where: { email },
    create: { email, status: "SUPPRESSED", source: provider ?? "provider", suppressedAt: now },
    update: { status: "SUPPRESSED", suppressedAt: now },
  });
  await db.marketingConsentEvent.create({
    data: { contactId: contact.id, type: "SUPPRESSED", source: provider ?? "provider", evidence: { reason } },
  });
}

export async function marketingContactMigrationPreview() {
  const [subscribers, accountOptIns, contacts, suppressions, conflicts] = await Promise.all([
    db.newsletterSubscriber.count({ where: { consent: true, unsubscribedAt: null } }),
    db.marketingConsent.count({ where: { email: true } }),
    db.marketingContact.groupBy({ by: ["status"], _count: { _all: true } }),
    db.emailSuppression.count(),
    db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "NewsletterSubscriber" ns
      JOIN "User" u ON lower(trim(u."email")) = lower(trim(ns."email"))
      JOIN "MarketingConsent" mc ON mc."userId" = u."id"
      WHERE (ns."consent" = false OR ns."unsubscribedAt" IS NOT NULL) AND mc."email" = true
    `),
  ]);
  return {
    legacyActiveSubscribers: subscribers,
    accountOptIns,
    contacts: Object.fromEntries(contacts.map((row) => [row.status, row._count._all])),
    suppressions,
    conflicts: Number(conflicts[0]?.count ?? 0),
  };
}

async function sendNewsletterOptInEmail(args: { email: string; token: string }) {
  const cfg = getEmailConfig();
  const confirmUrl = `${cfg.baseUrl}/newsletter/potvrdi?token=${encodeURIComponent(args.token)}`;
  const html = `<!doctype html><html lang="sr-Latn"><body style="margin:0;background:#FAF7F2;padding:32px 16px;font-family:Arial,sans-serif;color:#1A1714;"><div style="max-width:560px;margin:0 auto;background:white;border-radius:18px;padding:32px;"><h1 style="font-family:Georgia,serif;font-size:28px;margin:0 0 12px;">Potvrdite newsletter prijavu</h1><p style="font-size:15px;line-height:1.6;margin:0 0 22px;">Kliknite na dugme da potvrdite da želite akcije, kupone i najbolje ponude iz ${BRAND.name}.</p><a href="${escapeAttr(confirmUrl)}" style="display:inline-block;background:#1A1714;color:#FAF7F2;border-radius:999px;padding:13px 24px;text-decoration:none;font-weight:700;">Potvrdi prijavu</a><p style="font-size:12px;line-height:1.5;color:#6B6259;margin:22px 0 0;">Link važi 24 sata. Ako niste tražili prijavu, ignorišite ovu poruku.</p></div></body></html>`;
  return trackedDispatch({
    kind: "newsletter_opt_in",
    from: cfg.marketingFrom,
    to: args.email,
    subject: `Potvrdite newsletter prijavu — ${BRAND.name}`,
    html,
    text: `Potvrdite newsletter prijavu: ${confirmUrl}\n\nLink važi 24 sata.`,
    tags: { kind: "newsletter_opt_in" },
    idempotencyKey: `newsletter-opt-in:${digest(args.token)}`,
  });
}

async function syncMarketingContact(email: string) {
  await enqueueBackgroundJob({
    kind: "NEWSLETTER_SYNC",
    payload: { email },
    idempotencyKey: `newsletter-sync:${email}:${Date.now()}`,
  });
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cleanSource(value?: string | null) {
  const clean = value?.trim().slice(0, 60);
  return clean || "newsletter";
}

function pruneEvidence(value?: Record<string, string | null | undefined>) {
  if (!value) return undefined;
  const clean = Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item != null && item !== "")
      .map(([key, item]) =>
        key === "forwardedFor"
          ? ["ipHash", digest(String(item))]
          : [key.slice(0, 40), String(item).slice(0, 300)],
      ),
  );
  return Object.keys(clean).length ? clean as Prisma.InputJsonValue : undefined;
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
