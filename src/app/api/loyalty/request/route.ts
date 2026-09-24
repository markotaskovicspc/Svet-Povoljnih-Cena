import { NextResponse } from "next/server";
import { z } from "zod";
import { acceptLoyaltyConsent, LOYALTY_COOKIE, LOYALTY_SESSION_SECONDS } from "@/lib/loyalty/service.server";
import { LOYALTY_CONSENT_VERSION } from "@/lib/loyalty/shared";
import { checkRateLimitForRequest, rateLimitJson, RATE_LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const schema = z.object({ consent: z.literal(true), consentVersion: z.literal(LOYALTY_CONSENT_VERSION) });

export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return new NextResponse(null, { status: 403 });
  const limited = await checkRateLimitForRequest(req, "loyalty-request", RATE_LIMITS.passwordReset);
  if (!limited.ok) return rateLimitJson(limited);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Prihvatite saglasnost za pristupanje loyalty programu." }, { status: 400 });
  try {
    const session = await acceptLoyaltyConsent();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(LOYALTY_COOKIE, session, {
      httpOnly: true, secure: new URL(req.url).protocol === "https:", sameSite: "lax",
      path: "/", maxAge: LOYALTY_SESSION_SECONDS,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ ok: false, message: "Aktivacija nije uspela. Pokušajte ponovo." }, { status: 503 });
  }
}
