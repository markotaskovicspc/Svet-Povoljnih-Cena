import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createOrder, createOrderSchema } from "@/lib/api/checkout";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = checkRateLimitForRequest(
    req,
    "checkout-order",
    RATE_LIMITS.checkoutOrder,
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }
  const body = await req.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID", issues: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const user = await getCurrentUser();
  const userId = user?.userType === "customer" ? user.id : null;
  const result = await createOrder(parsed.data, userId);
  return NextResponse.json(result, { status: result.ok ? 201 : 422 });
}
