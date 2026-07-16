import { NextResponse } from "next/server";
import { z } from "zod";
import { createPasswordResetToken } from "@/lib/auth/credentials";
import { enqueueBackgroundJob, processBackgroundJob } from "@/lib/background-jobs";
import {
  checkRateLimitForRequest,
  rateLimitJson,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

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
  const limited = await checkRateLimitForRequest(
    req,
    "password-reset",
    RATE_LIMITS.passwordReset,
    [parsed.data.email],
  );
  if (!limited.ok) {
    return rateLimitJson(limited);
  }

  const issued = await createPasswordResetToken(parsed.data.email);
  if (issued) {
    try {
      const job = await enqueueBackgroundJob({
        kind: "PASSWORD_RESET_EMAIL",
        payload: { to: parsed.data.email, token: issued.token },
        idempotencyKey: `password-reset:${issued.token}`,
      });
      await processBackgroundJob(job.id);
    } catch (err) {
      console.error("[email] password-reset enqueue/send failed", err);
    }
  }
  return NextResponse.json({ ok: true });
}
