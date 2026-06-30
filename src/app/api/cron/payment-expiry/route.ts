import { NextResponse } from "next/server";
import { expirePendingPayments } from "@/lib/payments/expiry";
import { hasBearerSecret } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const expected = process.env.PAYMENT_EXPIRY_CRON_SECRET ?? process.env.CRON_SECRET;
  return hasBearerSecret(req, expected);
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1),
    500,
  );
  const summary = await expirePendingPayments(limit);
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
