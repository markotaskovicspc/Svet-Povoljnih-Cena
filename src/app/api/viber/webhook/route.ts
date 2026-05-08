import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  applyInboundEvent,
  getViberConfig,
  inboundEventSchema,
} from "@/lib/viber";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4E — Viber delivery-report webhook.
 *
 * Configure Viber Business to POST callbacks to:
 *   POST /api/viber/webhook
 *   x-webhook-secret: $VIBER_WEBHOOK_SECRET
 *
 * Viber posts one event per recipient (delivered / failed / seen / …);
 * we attribute by the `tracking_data` we set at send time.
 */
export async function POST(req: Request) {
  const cfg = getViberConfig();
  if (!cfg.webhookSecret) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }

  const provided =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!safeEqual(provided, cfg.webhookSecret)) {
    return NextResponse.json(
      { ok: false, error: "invalid_secret" },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = inboundEventSchema.safeParse(body);
  if (!parsed.success) {
    // 200 so Viber doesn't retry malformed payloads forever.
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 200 },
    );
  }

  const result = await applyInboundEvent(parsed.data);
  return NextResponse.json(result, { status: 200 });
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
