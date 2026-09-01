import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isCartRecoveryEnabled } from "@/lib/checkout/cart-recovery-policy";
import { getEmailConfig } from "@/lib/email/config";
import { dispatch } from "@/lib/email/transport";
import { hasBearerSecret } from "@/lib/security/bearer";

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

export async function POST(req: Request) {
  if (!hasBearerSecret(req, process.env.CRON_SECRET)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const email = getEmailConfig();
  const recipient = mailboxAddress(email.replyTo ?? email.from);
  const result = await dispatch({
    to: recipient,
    subject: "[TEST] Amazon SES integracija — Svet Povoljnih Cena",
    text: "Automatski produkcijski SES smoke test je uspešno pokrenut. Nije potrebna nikakva akcija.",
    html: "<p>Automatski produkcijski <strong>Amazon SES</strong> smoke test je uspešno pokrenut.</p><p>Nije potrebna nikakva akcija.</p>",
    tags: { kind: "ses-smoke-test" },
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : 502,
    headers: { "Cache-Control": "no-store" },
  });
}

function mailboxAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.trim() ?? value.trim();
}
