import { NextResponse } from "next/server";
import { ipsPaymentProvider, IpsConfigError, IpsGatewayError } from "@/lib/payments";
import { db } from "@/lib/db";
import { canAccessOrder, readOrderAccessToken } from "@/lib/api/order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params;
  const order = await db.order.findFirst({
    where: { OR: [{ id: orderId }, { number: orderId }] },
    select: {
      number: true,
      userId: true,
      publicAccessTokenHash: true,
      paymentMethod: true,
    },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: "unknown_order" }, { status: 404 });
  }
  if (
    !(await canAccessOrder({
      order,
      token: readOrderAccessToken(req),
    }))
  ) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (order.paymentMethod !== "IPS") {
    return NextResponse.json({ ok: false, error: "not_ips_order" }, { status: 400 });
  }

  try {
    const result = await ipsPaymentProvider.checkPaymentStatus(order.number);
    return NextResponse.json({
      ok: true,
      paid: result.paid,
      responseCode: result.responseCode,
      providerRef: result.providerRef,
      paymentReference: result.paymentReference,
    });
  } catch (err) {
    if (err instanceof IpsConfigError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    if (err instanceof IpsGatewayError) {
      console.error("[ips] status check failed", err);
      return NextResponse.json({ ok: false, error: "gateway_error" }, { status: 502 });
    }
    console.error("[ips] status failed", err);
    return NextResponse.json({ ok: false, error: "status_failed" }, { status: 400 });
  }
}

export const POST = GET;
