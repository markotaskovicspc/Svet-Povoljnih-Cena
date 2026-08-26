import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildMetaPurchasePayload,
  metaPurchaseEventId,
} from "@/lib/analytics/meta-ecommerce";
import { getMetaCapiConfig, sendMetaCapiEvent } from "@/lib/analytics/meta-capi.server";
import {
  allowsMarketing,
  readCookieValue,
  trackingConsentFromCookieHeader,
} from "@/lib/analytics/tracking-consent";
import { getPublicOrderForConfirmation } from "@/lib/api/orders";
import { isPurchaseReady } from "@/lib/analytics/ga4-ecommerce";
import { logOperationalError } from "@/lib/monitoring";
import {
  checkRateLimitForRequest,
  getClientIp,
  rateLimitJson,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentSchema = z.object({
  id: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(10_000),
  item_price: z.number().min(0).max(1_000_000_000),
});

const customDataSchema = z.object({
  currency: z.literal("RSD").optional(),
  value: z.number().min(0).max(1_000_000_000).optional(),
  content_ids: z.array(z.string().min(1).max(100)).max(200).optional(),
  content_type: z.literal("product").optional(),
  contents: z.array(contentSchema).max(200).optional(),
  content_name: z.string().max(300).optional(),
  content_category: z.string().max(500).optional(),
  num_items: z.number().int().min(1).max(10_000).optional(),
  order_id: z.string().max(100).optional(),
}).strict();

const eventSchema = z.object({
  eventName: z.enum([
    "PageView",
    "ViewContent",
    "AddToCart",
    "InitiateCheckout",
    "Purchase",
  ]),
  eventId: z.string().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/),
  path: z.string().min(1).max(500).regex(/^\/(?!\/)/),
  customData: customDataSchema.optional(),
  orderNumber: z.string().min(1).max(100).optional(),
  orderAccessToken: z.string().min(20).max(500).optional(),
}).strict();

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!allowsMarketing(trackingConsentFromCookieHeader(cookieHeader))) {
    return NextResponse.json(
      { ok: false, error: "marketing_consent_required" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  if (!getMetaCapiConfig()) {
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  const limited = await checkRateLimitForRequest(request, "meta-capi-events", {
    limit: 90,
    windowMs: 60_000,
  });
  if (!limited.ok) return rateLimitJson(limited);

  const parsed = eventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_meta_event" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  let customData = parsed.data.customData;
  let eventId = parsed.data.eventId;
  if (parsed.data.eventName === "Purchase") {
    if (!parsed.data.orderNumber || !parsed.data.orderAccessToken) {
      return NextResponse.json(
        { ok: false, error: "purchase_access_required" },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    const order = await getPublicOrderForConfirmation(
      parsed.data.orderNumber,
      parsed.data.orderAccessToken,
    );
    if (!order || !isPurchaseReady(order)) {
      return NextResponse.json(
        { ok: false, error: "purchase_not_ready" },
        { status: 409, headers: { "cache-control": "no-store" } },
      );
    }
    customData = buildMetaPurchasePayload(order);
    eventId = metaPurchaseEventId(order.id);
  }

  try {
    const clientIpAddress = getClientIp(request);
    await sendMetaCapiEvent({
      eventName: parsed.data.eventName,
      eventId,
      eventSourceUrl: sourceUrl(request, parsed.data.path),
      customData,
      clientIpAddress:
        clientIpAddress === "unknown" ? undefined : clientIpAddress.slice(0, 100),
      clientUserAgent: request.headers.get("user-agent")?.slice(0, 500),
      fbp: readCookieValue(cookieHeader, "_fbp")?.slice(0, 200),
      fbc: readCookieValue(cookieHeader, "_fbc")?.slice(0, 200),
    });
    return NextResponse.json(
      { ok: true },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    logOperationalError("analytics.meta_capi_failed", error, {
      eventName: parsed.data.eventName,
      eventId: parsed.data.eventId,
    });
    return NextResponse.json(
      { ok: false, error: "meta_capi_unavailable" },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

function sourceUrl(request: Request, path: string) {
  const configuredBase = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  const requestOrigin = new URL(request.url).origin;
  let origin = requestOrigin;
  try {
    if (configuredBase && !configuredBase.startsWith("GET_FROM_")) {
      origin = new URL(configuredBase).origin;
    }
  } catch {
    origin = requestOrigin;
  }
  return new URL(path, origin).toString();
}
