import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { isFirstPurchaseDiscountEligible } from "@/lib/checkout/first-purchase.server";
import { checkRateLimitForRequest, rateLimitJson } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const limited = await checkRateLimitForRequest(request, "first-purchase-offer", { limit: 30, windowMs: 60_000 });
  if (!limited.ok) return rateLimitJson(limited);
  const user = await getCurrentUser();
  const eligible = !user || (user.userType === "customer" && await isFirstPurchaseDiscountEligible(user.id));
  return NextResponse.json({ eligible }, { headers: { "cache-control": "private, no-store" } });
}
