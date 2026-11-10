import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AFFILIATE_COOKIE, AFFILIATE_WINDOW_SECONDS, normalizeAffiliateCode } from "@/lib/affiliate/shared";
import { allowsAnalytics, readCookieValue, trackingConsentFromCookieHeader } from "@/lib/analytics/tracking-consent";
import { checkRateLimitForRequest, rateLimitJson, RATE_LIMITS } from "@/lib/security/rate-limit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  // Reject cross-site writes, even if a browser sends cookies.
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const limited = await checkRateLimitForRequest(request, "affiliate-visit", RATE_LIMITS.checkoutOrder);
  if (!limited.ok) return rateLimitJson(limited);
  const cookie = request.headers.get("cookie");
  if (!allowsAnalytics(trackingConsentFromCookieHeader(cookie))) {
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(AFFILIATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }
  const body = await request.json().catch(() => null);
  const code = normalizeAffiliateCode(body?.code);
  if (!code) return new Response(null, { status: 400 });
  const partner = await db.affiliatePartner.findUnique({ where: { code }, select: { id: true, enabled: true } });
  if (!partner?.enabled) return new Response(null, { status: 404 });
  const previous = readCookieValue(cookie, AFFILIATE_COOKIE);
  const existing = previous && /^[0-9a-f-]{36}$/.test(previous) ? await db.affiliateClick.findFirst({
    where: { id: previous, partnerId: partner.id, expiresAt: { gt: new Date() } }, select: { id: true },
  }) : null;
  // Refresh/re-render never increases counts or extends the attribution window.
  if (existing) return new NextResponse(null, { status: 204 });
  const id = randomUUID();
  await db.affiliateClick.create({ data: { id, partnerId: partner.id, expiresAt: new Date(Date.now() + AFFILIATE_WINDOW_SECONDS * 1000) } });
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(AFFILIATE_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: AFFILIATE_WINDOW_SECONDS });
  return response;
}
