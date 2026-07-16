import { NextResponse } from "next/server";
import {
  adapterFromSlug,
  applyShipmentEvent,
  CourierConfigError,
} from "@/lib/courier";
import { CourierProviderError } from "@/lib/courier/types";
import { enqueueBackgroundJob } from "@/lib/background-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4C item 3 — courier status webhooks.
 *
 *   POST /api/courier/small/webhook  ← X Express (optional webhook)
 *   POST /api/courier/bulky/webhook  ← in-house dispatcher (kamionska)
 *
 * The body is verified per-adapter (HMAC-SHA256 over the raw bytes), then
 * normalized into a `CourierWebhookEvent` and applied via
 * `applyShipmentEvent`, which appends a `ShipmentEvent`, advances the
 * parent order status, and prepares the customer notification (email /
 * SMS / Viber send is the responsibility of 4D / 4E).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ service: string }> },
) {
  const { service } = await ctx.params;
  const adapter = adapterFromSlug(service);
  if (!adapter) {
    return NextResponse.json({ ok: false, error: "unknown_service" }, { status: 404 });
  }

  const rawBody = await req.text();

  let valid = false;
  try {
    valid = adapter.verifyWebhookSignature({ headers: req.headers, rawBody });
  } catch (err) {
    if (err instanceof CourierConfigError) {
      return NextResponse.json(
        { ok: false, error: "not_configured" },
        { status: 503 },
      );
    }
    throw err;
  }
  if (!valid) {
    return NextResponse.json(
      { ok: false, error: "invalid_signature" },
      { status: 401 },
    );
  }

  let event;
  try {
    event = adapter.parseWebhookEvent(rawBody);
  } catch (err) {
    if (err instanceof CourierProviderError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  const result = await applyShipmentEvent(adapter.service, event);
  if (!result) {
    return NextResponse.json(
      { ok: false, error: "unknown_tracking_no" },
      { status: 404 },
    );
  }

  // Phase 4D — let the customer know about the new shipment status.
  if (result.eventCreated && result.customerEmail) {
    await enqueueBackgroundJob({
      kind: "ORDER_STATUS_EMAIL",
      payload: { orderId: result.orderId },
      idempotencyKey: `order-status-email:${result.orderId}:${result.status}`,
    });
  }

  // Phase 4F — warehouse pickup is the legal trigger for the fiscal
  // receipt (Zakon o fiskalizaciji). Fire-and-forget so a transient
  // gateway error doesn't break the shipment webhook.
  if (result.eventCreated && result.status === "PICKED_UP") {
    await enqueueBackgroundJob({
      kind: "FISCAL_RECEIPT",
      payload: { orderId: result.orderId },
      idempotencyKey: `fiscal-pickup:${result.orderId}`,
    });
  }

  return NextResponse.json({ ok: true, status: result.status });
}
