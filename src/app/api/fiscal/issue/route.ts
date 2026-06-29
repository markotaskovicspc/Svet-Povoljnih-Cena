import { NextResponse } from "next/server";
import { PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { issueAndDeliverFiscalReceipt } from "@/lib/fiscal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4F — Admin-triggered fiscalization.
 *
 *   POST /api/fiscal/issue
 *   Authorization: Bearer $ADMIN_API_SECRET
 *   { "orderId": "ckxyz…" }
 *
 * Used both by:
 *   - the admin "Mark picked up" action when the warehouse confirms
 *     pickup outside the courier webhook flow, and
 *   - manual re-runs after a transient gateway failure.
 *
 * Idempotent: a second call for the same order returns the existing
 * `FiscalReceipt` without re-emailing (use `?resend=1` to force the
 * email even when the receipt is already issued).
 *
 * Auth uses the same shared-secret pattern as `/api/cron/*` so the
 * admin panel (Phase 5) can call it without the full session machinery
 * being in place yet.
 */

const bodySchema = z.object({
  orderId: z.string().min(1),
  orderItemIds: z.array(z.string().min(1)).optional(),
  paymentMethod: z.enum(PaymentMethod).optional(),
});

function isAuthorized(req: Request): boolean {
  const expected = process.env.ADMIN_API_SECRET ?? process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const result = await issueAndDeliverFiscalReceipt(parsed.data.orderId, {
    forceEmail: url.searchParams.get("resend") === "1",
    source: "MANUAL",
    paymentMethod: parsed.data.paymentMethod,
    orderItemIds: parsed.data.orderItemIds,
  });
  if (!result.outcome.ok) {
    const status = result.outcome.reason === "not_found" ? 404 : 502;
    return NextResponse.json(
      { ok: false, error: result.outcome.error, reason: result.outcome.reason },
      { status },
    );
  }
  return NextResponse.json({
    ok: true,
    created: result.outcome.created,
    receipt: {
      receiptNumber: result.outcome.receipt.receiptNumber,
      qrUrl: result.outcome.receipt.qrUrl,
      fiscalizedAt: result.outcome.receipt.fiscalizedAt.toISOString(),
    },
    emailed: result.emailed,
    emailError: result.emailError,
  });
}
