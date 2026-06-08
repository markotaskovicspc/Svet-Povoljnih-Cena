import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getEmailConfig, recordProviderEvent } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cfg = getEmailConfig();
  if (!cfg.resendWebhookSecret) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  if (!verifySvixSignature(req.headers, rawBody, cfg.resendWebhookSecret)) {
    return NextResponse.json(
      { ok: false, error: "invalid_signature" },
      { status: 401 },
    );
  }

  const payload = JSON.parse(rawBody) as ResendWebhookEvent;
  if (!payload.type) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  const eventId = req.headers.get("svix-id");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "missing_event_id" },
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

  return NextResponse.json({
    ok: true,
    duplicate: recorded.duplicate,
  });
}

interface ResendWebhookEvent {
  type?: string;
  data?: {
    id?: string;
    email_id?: string;
    emailId?: string;
    to?: string[] | string;
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
