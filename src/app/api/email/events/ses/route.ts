import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getEmailConfig } from "@/lib/email/config";
import { recordProviderEvent } from "@/lib/email/tracking";
import {
  isTrustedSnsUrl,
  mapSesEventType,
  type SnsEnvelope,
  verifySnsEnvelope,
} from "@/lib/email/sns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const topicArn = getEmailConfig().sesSnsTopicArn;
  if (!topicArn) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 1_000_000) {
    return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  }
  const raw = await req.text();
  let envelope: SnsEnvelope;
  try {
    envelope = JSON.parse(raw) as SnsEnvelope;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!(await verifySnsEnvelope(envelope, topicArn).catch(() => false))) {
    return NextResponse.json(
      { ok: false, error: "invalid_signature" },
      { status: 401 },
    );
  }

  if (envelope.Type === "SubscriptionConfirmation") {
    if (!envelope.SubscribeURL || !isTrustedSnsUrl(envelope.SubscribeURL)) {
      return NextResponse.json(
        { ok: false, error: "invalid_subscribe_url" },
        { status: 400 },
      );
    }
    const response = await fetch(envelope.SubscribeURL, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json({ ok: response.ok, confirmed: response.ok });
  }
  if (envelope.Type !== "Notification") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  let event: SesEvent;
  try {
    event = JSON.parse(envelope.Message) as SesEvent;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_ses_event" },
      { status: 400 },
    );
  }
  const eventType = mapSesEventType(event.eventType ?? event.notificationType ?? "");
  const providerMessageId = event.mail?.messageId ?? null;
  if (!eventType || !providerMessageId) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const recorded = await recordProviderEvent({
    provider: "ses",
    eventId: envelope.MessageId,
    type: eventType,
    providerMessageId,
    payload: event as Prisma.InputJsonValue,
  });
  return NextResponse.json({ ok: true, duplicate: recorded.duplicate });
}

type SesEvent = {
  eventType?: string;
  notificationType?: string;
  mail?: {
    messageId?: string;
    destination?: string[];
  };
  bounce?: { bouncedRecipients?: Array<{ emailAddress?: string }> };
  complaint?: { complainedRecipients?: Array<{ emailAddress?: string }> };
  [key: string]: unknown;
};
