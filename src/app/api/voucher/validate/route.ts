import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { validateVoucher } from "@/lib/api/vouchers";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  code: z.string().min(1).max(64),
  subtotal: z.number().nonnegative(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "Neispravan zahtev" }, { status: 400 });
  }
  const limited = checkRateLimitForRequest(
    req,
    "voucher",
    RATE_LIMITS.voucher,
    [parsed.data.code],
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const user = await getCurrentUser();
  const userId = user?.userType === "customer" ? user.id : null;
  const result = await validateVoucher(parsed.data.code, parsed.data.subtotal, userId);
  return NextResponse.json(result);
}
