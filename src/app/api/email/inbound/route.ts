import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  getEmailConfig,
  handleInboundMessage,
  normalizeInbound,
} from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Legacy/shared-secret inbound webhook for providers that POST the complete
 * parsed message (for example Postmark). Resend Receiving is handled by the
 * Svix-verified `/api/email/events` route and its durable background job.
 */
export async function POST(req: Request) {
  const cfg = getEmailConfig();
  if (!cfg.inboundSecret) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }

  const provided =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!safeEqual(provided, cfg.inboundSecret)) {
    return NextResponse.json(
      { ok: false, error: "invalid_secret" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const msg = normalizeInbound(body);
  if (!msg) {
    return NextResponse.json(
      { ok: false, error: "unrecognized_payload" },
      { status: 400 },
    );
  }

  const result = await handleInboundMessage(msg);
  if (!result.ok) {
    // Always 200 so the provider doesn't keep retrying messages addressed
    // to inboxes we don't care about (e.g. bounces forwarded to the
    // catch-all webhook by mistake).
    return NextResponse.json(result, { status: 200 });
  }
  return NextResponse.json(result, { status: 202 });
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
