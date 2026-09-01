import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isCartRecoveryEnabled } from "@/lib/checkout/cart-recovery-policy";
import { getEmailConfig } from "@/lib/email/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const email = getEmailConfig();
    return NextResponse.json(
      {
        ok: true,
        database: "up",
        latencyMs: Date.now() - startedAt,
        features: {
          abandonedCartRecovery: isCartRecoveryEnabled(),
        },
        readiness: {
          sesProvider: email.provider === "ses",
          sesCredentials: email.sesCredentialsConfigured,
          emailUnsubscribe: Boolean(email.unsubscribeSecret),
          sesEvents: Boolean(email.sesSnsTopicArn),
        },
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, database: "down", timestamp: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
