import { NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { allowsAnalytics, trackingConsentFromCookieHeader } from "@/lib/analytics/tracking-consent";
import { checkRateLimitForRequest, rateLimitJson } from "@/lib/security/rate-limit";
import { evaluateTrafficAlert } from "@/lib/admin/traffic-push.server";
export async function POST(request: Request) {
  if (!allowsAnalytics(trackingConsentFromCookieHeader(request.headers.get("cookie")))) return NextResponse.json({ ok: false }, { status: 403 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ ok: false }, { status: 403 });
  const limited = await checkRateLimitForRequest(request, "site-presence", { limit: 60, windowMs: 60_000 });
  if (!limited.ok) return rateLimitJson(limited);
  const body = await request.json().catch(() => null);
  if (typeof body?.anonymousId !== "string" || !/^v2:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.anonymousId)) return NextResponse.json({ ok: false }, { status: 400 });
  const now = new Date();
  await db.siteVisitorPresence.upsert({ where: { anonymousId: body.anonymousId },
    create: { anonymousId: body.anonymousId, lastSeenAt: now }, update: { lastSeenAt: now } });
  after(async () => { try { await evaluateTrafficAlert(); } catch { console.error("[traffic-alert] Evaluation failed; cron will retry."); } });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
