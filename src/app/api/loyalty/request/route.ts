import { NextResponse } from "next/server";
import { z } from "zod";
import { requestLoyaltyConfirmation, LOYALTY_COOKIE, LOYALTY_SESSION_SECONDS } from "@/lib/loyalty/service.server";
import { LOYALTY_CONSENT_VERSION, normalizeLoyaltyEmail } from "@/lib/loyalty/shared";
import { checkRateLimit, checkRateLimitForRequest, rateLimitJson, rateLimitKey, RATE_LIMITS } from "@/lib/security/rate-limit";
import { dispatch } from "@/lib/email/transport";
import { getEmailConfig } from "@/lib/email/config";

export const runtime = "nodejs";
const schema = z.object({ email: z.string().trim().email().max(254), consent: z.literal(true), consentVersion: z.literal(LOYALTY_CONSENT_VERSION) });

export async function POST(req: Request) {
  const limited = await checkRateLimitForRequest(req, "loyalty-request", RATE_LIMITS.passwordReset);
  if (!limited.ok) return rateLimitJson(limited);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Unesite ispravnu mejl adresu i prihvatite saglasnost." }, { status: 400 });
  const email = normalizeLoyaltyEmail(parsed.data.email);
  const identityLimit = await checkRateLimit(rateLimitKey("loyalty-email", email), RATE_LIMITS.passwordReset);
  if (!identityLimit.ok) return rateLimitJson(identityLimit);
  try {
    const config = getEmailConfig();
    if (config.provider === "none") return NextResponse.json({ ok: false, message: "Slanje mejla trenutno nije dostupno. Pokušajte kasnije." }, { status: 503 });
    const { token, browserSession } = await requestLoyaltyConfirmation(email);
    const link = new URL("/api/loyalty/confirm", config.baseUrl);
    link.searchParams.set("token", token);
    const result = await dispatch({
      to: email, subject: "Potvrdite mejl za SPC loyalty pogodnosti",
      text: `Potvrdite mejl i aktivirajte loyalty pogodnosti bez naloga ili kartice: ${link.href}\nLink važi 30 minuta. Ako niste tražili pristupanje, zanemarite ovu poruku.`,
      html: `<h1>Dobro došli u SPC loyalty program</h1><p>Potvrdite mejl i aktivirajte pogodnosti bez naloga ili fizičke kartice.</p><p><a href="${link.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">Potvrdi mejl i aktiviraj loyalty</a></p><p>Link važi 30 minuta. Ako niste tražili pristupanje, zanemarite ovu poruku.</p>`,
    });
    if (!result.ok) throw new Error("Delivery failed");
    const response = NextResponse.json({ ok: true });
    response.cookies.set(LOYALTY_COOKIE, browserSession, {
      httpOnly: true, secure: new URL(req.url).protocol === "https:", sameSite: "lax",
      path: "/", maxAge: LOYALTY_SESSION_SECONDS,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ ok: false, message: "Mejl nije poslat. Pokušajte ponovo." }, { status: 503 });
  }
}
