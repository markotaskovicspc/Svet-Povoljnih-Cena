import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { sendEmailConfirmationForUser } from "@/lib/auth/email-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const sessionUser = await getCurrentUser();
  if (!sessionUser || sessionUser.userType !== "customer") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
