import { NextResponse } from "next/server";
import { ipsPaymentProvider, IpsConfigError } from "@/lib/payments";
import { db } from "@/lib/db";
import { logOperationalError } from "@/lib/monitoring";
import {
  RATE_LIMITS,
  checkRateLimitForRequest,
  checkRateLimit,
  rateLimitJson,
  rateLimitKey,
  getClientIp,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Payten IPS PGW (v1.5) posts a plain, UNSIGNED JSON body to this URL as a mere
// wake-up ping — no signatures, no timestamp. We never trust or apply the body:
// on a valid ping we do our own server→gateway checkStatus round-trip, which
// verifies and applies the result. Almost every path returns HTTP 200 on purpose
// so Payten treats the callback as delivered and does not enter a retry storm.
export async function POST(req: Request) {
  // Per-IP throttle: cap how fast any single source can poke the endpoint.
  const ipLimit = await checkRateLimitForRequest(req, "ipsCallback", RATE_LIMITS.ipsCallback);
  if (!ipLimit.ok) return rateLimitJson(ipLimit);

  try {
    const rawBody = await req.text();
    const payload = readPayload(req, rawBody);
    const orderId =
      typeof (payload as { orderId?: unknown }).orderId === "string"
        ? (payload as { orderId: string }).orderId.trim()
        : "";

    if (!orderId) {
      logOperationalError("payment.ips.callback_missing_order", new Error("missing_order_id"), {
        clientIp: getClientIp(req),
      });
      return NextResponse.json({ ok: true });
    }

    // Only accept orders that actually started an IPS payment (the start route is
    // the sole creator of IPS Payment rows). Unknown orderId → no gateway call,
    // no info leak, and probing forged ids costs nothing beyond a DB lookup.
    const order = await db.order.findFirst({
      where: {
        OR: [{ id: orderId }, { number: orderId }],
        paymentMethod: "IPS",
        payments: { some: { provider: "IPS" } },
      },
      select: {
        id: true,
        number: true,
        payments: {
          where: { provider: "IPS" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true },
        },
      },
    });

    if (!order) {
      logOperationalError("payment.ips.callback_unknown_order", new Error("unknown_order"), {
        orderId,
        clientIp: getClientIp(req),
      });
      return NextResponse.json({ ok: true });
    }

    // Already settled — nothing to re-check against the gateway.
    if (order.payments[0]?.status === "PAID") {
      return NextResponse.json({ ok: true, paid: true });
    }

    // Per-order throttle keyed on the internal id. On breach we still return 200
    // (not 429) so the gateway doesn't escalate into a retry storm.
    const orderLimit = await checkRateLimit(
      rateLimitKey("ipsCallbackOrder", order.id),
      RATE_LIMITS.ipsCallbackOrder,
    );
    if (!orderLimit.ok) return NextResponse.json({ ok: true });

    const result = await ipsPaymentProvider.checkPaymentStatus(order.number);
    return NextResponse.json({ ok: true, paid: result.paid });
  } catch (err) {
    if (err instanceof IpsConfigError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    logOperationalError("payment.ips.callback_verify_failed", err, {
      contentType: req.headers.get("content-type") ?? null,
      clientIp: getClientIp(req),
    });
    return NextResponse.json({ ok: true });
  }
}

function readPayload(req: Request, rawBody: string): unknown {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(rawBody);
  return Object.fromEntries(params.entries());
}
