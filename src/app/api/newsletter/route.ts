import { NextResponse } from "next/server";
import { subscribeNewsletter, subscribeSchema } from "@/lib/api/newsletter";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", issues: parsed.error.flatten() }, { status: 400 });
  }
  const limited = await checkRateLimitForRequest(
    req,
    "newsletter:subscribe",
    RATE_LIMITS.newsletter,
    [parsed.data.email],
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  try {
    await subscribeNewsletter(parsed.data, {
      userAgent: req.headers.get("user-agent"),
      forwardedFor: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    });
  } catch (error) {
    // A public response must not reveal whether an address already exists.
    // Operational failures remain visible in server logs and tracked email state.
    console.error("[newsletter] opt-in request failed", error);
  }
  // Never expose whether an address is active, pending, suppressed or new.
  return NextResponse.json({ ok: true }, { status: 202 });
}
