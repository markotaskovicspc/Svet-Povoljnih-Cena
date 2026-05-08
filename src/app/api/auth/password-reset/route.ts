import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordResetToken } from "@/lib/auth/credentials";
import { sendPasswordReset } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ email: z.email() });

/**
 * Phase 4D — request a password-reset link.
 *
 * Always responds 200 with `{ ok: true }` so an attacker can't enumerate
 * registered emails. The actual token + email send happens server-side and
 * is silently skipped for unknown / disabled accounts.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const issued = await createPasswordResetToken(parsed.data.email);
  if (issued) {
    void sendPasswordReset({
      to: parsed.data.email,
      token: issued.token,
      expiresInMinutes: 60,
    }).catch((err) => {
      console.error("[email] password-reset send failed", err);
    });
  }
  return NextResponse.json({ ok: true });
}
