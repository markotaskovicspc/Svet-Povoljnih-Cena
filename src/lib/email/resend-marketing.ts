import "server-only";

import { db } from "@/lib/db";
import { getEmailConfig } from "./config";
import { isEmailSuppressed } from "./tracking";

interface SyncContactInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  unsubscribed: boolean;
  source: string;
  userId?: string | null;
  promotionalAudience?: boolean;
  properties?: Record<string, string | null | undefined>;
}

export async function syncResendContact(input: SyncContactInput) {
  const cfg = getEmailConfig();
  const email = input.email.trim().toLowerCase();
  if (cfg.provider !== "resend" || !cfg.apiKey || !email) {
    return { ok: true as const, skipped: true as const };
  }

  const suppressed = await isEmailSuppressed(email).catch(() => false);
  const unsubscribed = input.unsubscribed || suppressed;
  const properties = pruneProperties({
    customer_id: input.userId,
    consent_source: input.source,
    preferred_locale: "sr-Latn",
    ...input.properties,
  });

  const baseBody: Record<string, unknown> = {
    email,
    unsubscribed,
    properties,
  };
  if (input.firstName) baseBody.firstName = input.firstName;
  if (input.lastName) baseBody.lastName = input.lastName;

  const topics = cfg.promotionsTopicId
    ? [
        {
          id: cfg.promotionsTopicId,
          subscription:
            input.promotionalAudience && !unsubscribed ? "opt_in" : "opt_out",
        },
      ]
    : null;
  const body: Record<string, unknown> = { ...baseBody };
  if (input.promotionalAudience && cfg.newsletterSegmentId && !unsubscribed) {
    body.segments = [{ id: cfg.newsletterSegmentId }];
  }
  if (topics) {
    body.topics = topics;
  }

  const created = await resendRequest("POST", "/contacts", body, cfg.apiKey);
  if (created.ok) return created;

  const updated = await resendRequest(
    "PATCH",
    `/contacts/${encodeURIComponent(email)}`,
    body,
    cfg.apiKey,
  );
  if (updated.ok) {
    if (topics) {
      await resendRequest(
        "PATCH",
        `/contacts/${encodeURIComponent(email)}/topics`,
        { topics },
        cfg.apiKey,
      );
    }
    return updated;
  }

  console.error("[email] Resend contact sync failed", {
    email,
    create: created.error,
    update: updated.error,
  });
  return updated;
}

export async function syncNewsletterSubscriberToResend(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  const sub = await db.newsletterSubscriber.findUnique({ where: { email } });
  if (!sub) return { ok: true as const, skipped: true as const };
  return syncResendContact({
    email: sub.email,
    unsubscribed: !sub.consent || Boolean(sub.unsubscribedAt),
    source: sub.source ?? "newsletter",
    properties: {
      consent_source: sub.source ?? "newsletter",
      subscribed_at: sub.createdAt.toISOString(),
    },
  });
}

export async function syncUserMarketingConsentToResend(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      language: true,
      deletedAt: true,
      marketingConsent: { select: { email: true, updatedAt: true } },
      orders: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  if (!user?.email || user.deletedAt) {
    return { ok: true as const, skipped: true as const };
  }

  return syncResendContact({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    userId: user.id,
    unsubscribed: user.marketingConsent?.email !== true,
    promotionalAudience: user.marketingConsent?.email === true,
    source: "account",
    properties: {
      customer_id: user.id,
      preferred_locale: user.language,
      consent_source: "account",
      consent_updated_at: user.marketingConsent?.updatedAt.toISOString(),
      last_order_date: user.orders[0]?.createdAt.toISOString(),
      segment_hint: user.orders.length ? "customer" : "registered",
    },
  });
}

export async function syncResendMarketingContacts(limit = 500) {
  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      email: { not: null },
      marketingConsent: { email: true },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { id: true },
  });

  let synced = 0;
  let failed = 0;
  for (const user of users) {
    const result = await syncUserMarketingConsentToResend(user.id);
    if (result.ok) synced += 1;
    else failed += 1;
  }
  return { synced, failed };
}

async function resendRequest(
  method: "POST" | "PATCH",
  path: string,
  body: Record<string, unknown>,
  apiKey: string,
) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true as const };
  const json = (await res.json().catch(() => ({}))) as {
    message?: string;
    name?: string;
  };
  return {
    ok: false as const,
    error: `${method} ${path}: ${res.status} ${json.message ?? json.name ?? "unknown"}`,
  };
}

function pruneProperties(input: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => [key, String(value)]),
  );
}
