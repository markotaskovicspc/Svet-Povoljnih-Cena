import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { requireAdminAction } from "@/lib/admin";
import { logAudit } from "@/lib/admin/audit";
import { ipsPaymentProvider, IpsConfigError, IpsGatewayError } from "@/lib/payments";
import { logOperationalError } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const admin = await requireAdminAction(["OPS"]);
  const { orderId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { number: orderId }] },
    select: { id: true, number: true, total: true, paymentMethod: true },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "unknown_order" }, { status: 404 });
  }
  if (order.paymentMethod !== "IPS") {
    return NextResponse.json({ ok: false, error: "not_ips_order" }, { status: 400 });
  }

  const amount = body.amount == null ? num(order.total) : Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400 });
  }
  const idempotencyKey = req.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 160) {
    return NextResponse.json({ ok: false, error: "idempotency_key_required" }, { status: 400 });
  }

  try {
    const result = await ipsPaymentProvider.refundPayment(order.number, amount, {
      idempotencyKey: `api:${idempotencyKey}`,
      actorId: admin.id,
    });
    await logAudit({
      actorId: admin.id,
      action: "order.ipsRefund.api",
      entity: "PaymentRefund",
      entityId: result.refundId,
      diff: { orderId: order.id, amount, responseCode: result.responseCode },
    });
    return NextResponse.json({
      ok: result.refunded,
      refunded: result.refunded,
      responseCode: result.responseCode,
      refundId: result.refundId,
    });
  } catch (err) {
    if (err instanceof IpsConfigError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    if (err instanceof IpsGatewayError) {
      logOperationalError("payment.ips.refund_gateway_failed", err, {
        orderId: order.id,
        orderNumber: order.number,
        amount,
      });
      return NextResponse.json(
        { ok: false, error: "gateway_error" },
        { status: 502 },
      );
    }
    logOperationalError("payment.ips.refund_failed", err, {
      orderId: order.id,
      orderNumber: order.number,
      amount,
    });
    const message = err instanceof Error ? err.message : "refund_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
