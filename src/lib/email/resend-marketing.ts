import "server-only";

import { db } from "@/lib/db";
import { getEmailConfig } from "./config";
import { isEmailSuppressed } from "./tracking";

export type ResendSubscriptionIntent = "grant" | "withdraw" | "preserve";

interface SyncContactInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  unsubscribed: boolean;
  source: string;
  promotionalAudience?: boolean;
  subscriptionIntent?: ResendSubscriptionIntent;
}

type ResendRequestResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status: number };

type SyncResult =
  | { ok: true; skipped?: true; providerOptedOut?: true; reconciled?: true }
  | { ok: false; error: string; status: number };

export async function syncResendContact(input: SyncContactInput): Promise<SyncResult> {
  const cfg = getEmailConfig();
  const email = input.email.trim().toLowerCase();
  if (cfg.provider !== "resend" || !cfg.apiKey || !email) {
    return { ok: true, skipped: true };
  }

  const suppressed = await isEmailSuppressed(email).catch(() => false);
  const intent: ResendSubscriptionIntent = suppressed || input.unsubscribed
    ? "withdraw"
    : input.subscriptionIntent ?? "preserve";
  const contactPath = `/contacts/${encodeURIComponent(email)}`;
  const existing = await resendRequest("GET", contactPath, undefined, cfg.apiKey);

  if (!existing.ok && existing.status !== 404) return existing;

  if (!existing.ok) {
    // Do not create a provider contact merely to record an opt-out.
    if (intent === "withdraw") return { ok: true, skipped: true };
    const createBody: Record<string, unknown> = { email, unsubscribed: false };
    if (input.firstName) createBody.first_name = input.firstName;
    if (input.lastName) createBody.last_name = input.lastName;
    if (input.promotionalAudience && cfg.newsletterSegmentId) {
      createBody.segments = [{ id: cfg.newsletterSegmentId }];
    }
    if (input.promotionalAudience && cfg.promotionsTopicId) {
      createBody.topics = [{ id: cfg.promotionsTopicId, subscription: "opt_in" }];
    }
    const created = await resendRequest("POST", "/contacts", createBody, cfg.apiKey);
    return created.ok ? { ok: true } : created;
  }

  // Reconciliation is fail-closed: campaign preparation never overwrites a
  // preference selected on Resend's unsubscribe page.
  if (intent === "preserve" && input.promotionalAudience) {
    if (providerGloballyUnsubscribed(existing.data)) {
      return { ok: true, providerOptedOut: true };
    }
    if (cfg.promotionsTopicId) {
      const topics = await resendRequest(
        "GET",
        `${contactPath}/topics`,
        undefined,
        cfg.apiKey,
      );
      if (!topics.ok) return topics;
      if (!providerTopicOptedIn(topics.data, cfg.promotionsTopicId)) {
        return { ok: true, providerOptedOut: true };
      }
    }
  }

  if (intent !== "preserve") {
    const updated = await resendRequest(
      "PATCH",
      contactPath,
      { unsubscribed: intent === "withdraw" },
      cfg.apiKey,
    );
    if (!updated.ok) return updated;
    if (cfg.promotionsTopicId) {
      const topicResult = await resendRequest(
        "PATCH",
        `${contactPath}/topics`,
        [{
          id: cfg.promotionsTopicId,
          subscription: intent === "grant" ? "opt_in" : "opt_out",
        }],
        cfg.apiKey,
      );
      if (!topicResult.ok) return topicResult;
    }
  }

  return { ok: true };
}

export async function syncNewsletterSubscriberToResend(
  emailRaw: string,
  subscriptionIntent: ResendSubscriptionIntent = "preserve",
) {
  const email = emailRaw.trim().toLowerCase();
  const [contact, sub] = await Promise.all([
    db.marketingContact.findUnique({ where: { email } }),
    db.newsletterSubscriber.findUnique({ where: { email } }),
  ]);
  if (!contact && !sub) return { ok: true as const, skipped: true as const };
  const active = contact
    ? contact.status === "ACTIVE"
    : Boolean(sub?.consent && !sub.unsubscribedAt);
  const result = await syncResendContact({
    email,
    firstName: contact?.firstName,
    lastName: contact?.lastName,
    unsubscribed: !active,
    promotionalAudience: active,
    subscriptionIntent: active ? subscriptionIntent : "withdraw",
    source: contact?.source ?? sub?.source ?? "newsletter",
  });
  if (result.ok && result.providerOptedOut && active) {
    const { withdrawMarketingEmail } = await import("@/lib/newsletter/contacts");
    await withdrawMarketingEmail(email, "resend-preference-reconciliation");
    return { ok: true as const, reconciled: true as const };
  }
  return result;
}

export async function syncUserMarketingConsentToResend(
  userId: string,
  subscriptionIntent: ResendSubscriptionIntent = "preserve",
) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      deletedAt: true,
      marketingContact: { select: { status: true } },
      marketingConsent: { select: { email: true } },
    },
  });
  if (!user?.email || user.deletedAt) {
    return { ok: true as const, skipped: true as const };
  }

  const active = user.marketingConsent?.email === true && user.marketingContact?.status === "ACTIVE";
  const result = await syncResendContact({
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    unsubscribed: !active,
    promotionalAudience: active,
    subscriptionIntent: active ? subscriptionIntent : "withdraw",
    source: "account",
  });
  if (result.ok && result.providerOptedOut && active) {
    const { withdrawMarketingEmail } = await import("@/lib/newsletter/contacts");
    await withdrawMarketingEmail(user.email, "resend-preference-reconciliation");
    return { ok: true as const, reconciled: true as const };
  }
  return result;
}

export async function syncResendMarketingContacts(limit = 500) {
  const contacts = await db.marketingContact.findMany({
    where: { status: "ACTIVE" },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(limit, 1), 1_000),
    select: { email: true },
  });

  let synced = 0;
  let failed = 0;
  let reconciled = 0;
  for (const contact of contacts) {
    const result = await syncNewsletterSubscriberToResend(contact.email, "preserve");
    if (result.ok) {
      synced += 1;
      if ("reconciled" in result && result.reconciled) reconciled += 1;
    } else {
      failed += 1;
    }
  }
  return { synced, failed, reconciled };
}

async function resendRequest(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body: Record<string, unknown> | ReadonlyArray<Record<string, unknown>> | undefined,
  apiKey: string,
): Promise<ResendRequestResult> {
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "SvetPovoljnihCena-Marketing/1.0",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data };
  const json = data as { message?: string; name?: string };
  return {
    ok: false,
    status: res.status,
    error: `${method} ${path}: ${res.status} ${json.message ?? json.name ?? "unknown"}`,
  };
}

function providerGloballyUnsubscribed(data: unknown) {
  return Boolean(data && typeof data === "object" && !Array.isArray(data) && (
    data as { unsubscribed?: unknown }
  ).unsubscribed === true);
}

function providerTopicOptedIn(data: unknown, topicId: string) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const rows = (data as { data?: unknown }).data;
  if (!Array.isArray(rows)) return false;
  return rows.some((row) => (
    row && typeof row === "object" && !Array.isArray(row) &&
    (row as { id?: unknown }).id === topicId &&
    (row as { subscription?: unknown }).subscription === "opt_in"
  ));
}
