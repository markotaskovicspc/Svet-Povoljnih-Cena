import "server-only";
import { db } from "@/lib/db";
import { AFFILIATE_COOKIE } from "./shared";
import { allowsAnalytics, readCookieValue, trackingConsentFromCookieHeader } from "@/lib/analytics/tracking-consent";

/** Only the trusted HTTP route supplies this value, never checkout JSON. */
export async function affiliateClickFromRequest(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!allowsAnalytics(trackingConsentFromCookieHeader(cookie))) return undefined;
  const id = readCookieValue(cookie, AFFILIATE_COOKIE);
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const click = await db.affiliateClick.findFirst({
    where: { id, expiresAt: { gt: new Date() }, partner: { enabled: true } }, select: { id: true },
  });
  return click?.id;
}
