import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { sendEmailConfirmationForUser } from "@/lib/auth/email-verification";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sessionUser = await getCurrentUser();
  if (!sessionUser || sessionUser.userType !== "customer") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const limited = checkRateLimitForRequest(
    req,
    "email-verification",
    RATE_LIMITS.passwordReset,
    [sessionUser.id],
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }

  const user = await db.user.findUnique({
    where: { id: sessionUser.id },
    select: { email: true, emailVerified: true, deletedAt: true },
  });
  if (!user?.email || user.deletedAt) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (user.emailVerified) {
    return NextResponse.json({ ok: true, verified: true });
  }

  const result = await sendEmailConfirmationForUser(sessionUser.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "send_failed" },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, verified: false });
}
