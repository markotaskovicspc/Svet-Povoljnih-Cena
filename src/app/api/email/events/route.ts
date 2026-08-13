import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { after, NextResponse } from "next/server";
import {
  enqueueBackgroundJob,
  processBackgroundJob,
} from "@/lib/background-jobs";
import { getEmailConfig, recordProviderEvent } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const cfg = getEmailConfig();
  if (!cfg.resendWebhookSecret) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }

  const eventId = req.headers.get("svix-id");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "missing_event_id" },
      { status: 400 },
    );
  }

  const rawBody = await req.text();
  if (!verifySvixSignature(req.headers, rawBody, cfg.resendWebhookSecret)) {
    return NextResponse.json(
      { ok: false, error: "invalid_signature" },
      { status: 401 },
    );
  }

  let payload: ResendWebhookEvent;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SyntaxError("Webhook body must be a JSON object.");
    }
    payload = parsed as ResendWebhookEvent;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  if (!payload.type) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  const providerMessageId =
    payload.data?.email_id ?? payload.data?.emailId ?? payload.data?.id ?? null;
  const recorded = await recordProviderEvent({
    provider: "resend",
    eventId,
    type: payload.type,
    providerMessageId,
    payload: payload as Prisma.InputJsonValue,
  });
  const { recordNewsletterProviderEvent } = await import("@/lib/newsletter/campaigns");
  const newsletter = await recordNewsletterProviderEvent(payload);
  if (
    payload.type === "contact.updated" &&
    payload.data?.unsubscribed === true &&
    typeof payload.data?.email === "string"
  ) {
    const { withdrawMarketingEmail } = await import("@/lib/newsletter/contacts");
    await withdrawMarketingEmail(payload.data.email, "resend-preference-page");
  }

  let inbound:
    | { queued: true; jobId: string; jobStatus: string }
    | { queued: false; reason: string }
    | null = null;
  if (payload.type === "email.received") {
    const emailId = payload.data?.email_id;
    if (!emailId) {
      inbound = { queued: false, reason: "missing_email_id" };
    } else {
      const job = await enqueueBackgroundJob({
        kind: "RESEND_INBOUND_EMAIL",
        payload: { emailId, eventId },
        idempotencyKey: `resend-inbound:${emailId}`,
        maxAttempts: 8,
      });
      inbound = { queued: true, jobId: job.id, jobStatus: job.status };
      after(async () => {
        try {
          const result = await processBackgroundJob(job.id);
          if (result.claimed && !result.ok) {
            console.error("[email] immediate inbound processing failed", {
              jobId: job.id,
              exhausted: result.exhausted,
              permanent: result.permanent,
            });
          }
        } catch (error) {
          console.error("[email] immediate inbound processing crashed", error);
        }
      });
    }
  }

  return NextResponse.json({
    ok: true,
    duplicate: recorded.duplicate,
    newsletterMatched: newsletter.matched,
    inbound,
  });
}

interface ResendWebhookEvent {
  type?: string;
  data?: {
    id?: string;
    email_id?: string;
    emailId?: string;
    to?: string[] | string;
    broadcast_id?: string;
    email?: string;
    unsubscribed?: boolean;
  };
  [key: string]: unknown;
}

function verifySvixSignature(headers: Headers, rawBody: string, secret: string) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 5 * 60) return false;

  const secretBytes = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice("whsec_".length), "base64")
    : Buffer.from(secret, "utf8");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  return signature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => {
      const candidate = part.includes(",") ? part.split(",")[1] : part;
      return safeEqual(candidate, expected);
    });
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
