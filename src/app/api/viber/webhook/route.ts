import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
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
  if (!cfg.webhookSecret && !cfg.apiKey) {
    return NextResponse.json(
      { ok: false, error: "not_configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const officialSignature = req.headers.get("x-viber-content-signature");
  const provided =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  const officialValid =
    Boolean(officialSignature && cfg.apiKey) &&
    safeEqual(
      officialSignature ?? "",
      createHmac("sha256", cfg.apiKey ?? "").update(rawBody).digest("hex"),
    );
  const sharedSecretValid = Boolean(cfg.webhookSecret) &&
    safeEqual(provided, cfg.webhookSecret ?? "");
  if (!officialValid && !sharedSecretValid) {
    return NextResponse.json(
      { ok: false, error: "invalid_secret" },
      { status: 401 },
    );
  }

  const body = (() => {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return null;
    }
  })();
  const parsed = inboundEventSchema.safeParse(body);
  if (!parsed.success) {
    // 200 so Viber doesn't retry malformed payloads forever.
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 200 },
    );
  }

  const result = await applyInboundEvent(
    parsed.data,
    req.headers.get("x-viber-event-id"),
  );
  return NextResponse.json(result, { status: 200 });
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
