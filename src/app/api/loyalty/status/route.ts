import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getGuestLoyaltyMember } from "@/lib/loyalty/session.server";
import { LOYALTY_COOKIE, revokeLoyaltySession, isLoyaltyConfirmationPending } from "@/lib/loyalty/service.server";
import { isFirstPurchaseDiscountEligible } from "@/lib/checkout/first-purchase.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const member = await getGuestLoyaltyMember();
  return NextResponse.json({
    active: Boolean(member),
    email: member?.email ?? null,
    pending: !member && await isLoyaltyConfirmationPending((await cookies()).get(LOYALTY_COOKIE)?.value),
    firstPurchase: member?.email ? await isFirstPurchaseDiscountEligible(null, member.email) : false,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(req: Request) {
  if (req.headers.get("origin") !== new URL(req.url).origin) return new NextResponse(null, { status: 403 });
  await revokeLoyaltySession((await cookies()).get(LOYALTY_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOYALTY_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  return response;
}
