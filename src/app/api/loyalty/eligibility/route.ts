import { NextResponse } from "next/server";
import { z } from "zod";
import { getGuestLoyaltyMember } from "@/lib/loyalty/session.server";
import { isFirstPurchaseDiscountEligible } from "@/lib/checkout/first-purchase.server";
import { normalizeLoyaltyEmail } from "@/lib/loyalty/shared";
import { checkRateLimitForRequest, rateLimitJson, RATE_LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const schema = z.object({ email: z.string().trim().email().max(254) });
export async function POST(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return new NextResponse(null, { status: 403 });
  const limited = await checkRateLimitForRequest(req, "loyalty-eligibility", RATE_LIMITS.checkoutOrder);
  if (!limited.ok) return rateLimitJson(limited);
  if (!await getGuestLoyaltyMember()) return new NextResponse(null, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const firstPurchase = await isFirstPurchaseDiscountEligible(null, normalizeLoyaltyEmail(parsed.data.email));
  return NextResponse.json({ firstPurchase }, { headers: { "Cache-Control": "private, no-store" } });
}
