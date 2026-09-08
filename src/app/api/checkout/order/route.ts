import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createOrder, createOrderSchema } from "@/lib/api/checkout";
import { logOperationalError } from "@/lib/monitoring";
import { checkoutFollowUpKey } from "@/lib/checkout/outbox";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import {
  allowsAnalytics,
  trackingConsentFromCookieHeader,
} from "@/lib/analytics/tracking-consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasAnalyticsConsent(request: Request) {
  return allowsAnalytics(
    trackingConsentFromCookieHeader(request.headers.get("cookie")),
  );
}

export async function POST(req: Request) {
  const limited = await checkRateLimitForRequest(
    req,
    "checkout-order",
    RATE_LIMITS.checkoutOrder,
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const body = await req.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID", issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const user = await getCurrentUser();
  const userId = user?.userType === "customer" ? user.id : null;
  try {
    const result = await createOrder(
      {
        ...parsed.data,
        analytics: hasAnalyticsConsent(req) ? parsed.data.analytics : undefined,
      },
      userId,
    );
    if (result.ok) {
      // The durable job is already committed. Even an import failure or a
      // platform timeout here cannot turn a saved order into a checkout 500.
      try {
        after(async () => {
          if (userId) {
            try {
              const { clearServerCart } = await import("@/lib/api/cart");
              await clearServerCart(userId);
            } catch (error) {
              logOperationalError("checkout.cart.clear_failed", error, { orderId: result.data.id });
            }
          }
          try {
            const { db } = await import("@/lib/db");
            const job = await db.backgroundJob.findUnique({
              where: { idempotencyKey: checkoutFollowUpKey(result.data.id) },
              select: { id: true },
            });
            if (!job) throw new Error("Checkout follow-up job missing");
            const { processBackgroundJob } = await import("@/lib/background-jobs");
            await processBackgroundJob(job.id);
          } catch (error) {
            logOperationalError("checkout.follow_up.immediate_failed", error, { orderId: result.data.id });
          }
        });
      } catch (error) {
        // Cron remains the durable fallback if after() cannot be scheduled.
        logOperationalError("checkout.follow_up.schedule_failed", error, { orderId: result.data.id });
      }
    }
    return NextResponse.json(result, { status: result.ok ? 201 : 422 });
  } catch (err) {
    logOperationalError("checkout.order.create_failed", err, {
      userId,
      checkoutSessionId: parsed.data.checkoutSessionId ?? null,
      skus: parsed.data.lines.map((line) => line.sku),
    });
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL" } },
      { status: 500 },
    );
  }
}
