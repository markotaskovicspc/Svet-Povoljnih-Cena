import { NextResponse } from "next/server";
import { ipsPaymentProvider, IpsConfigError, IpsGatewayError } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await ctx.params;
  try {
    const result = await ipsPaymentProvider.checkPaymentStatus(orderId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof IpsConfigError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    if (err instanceof IpsGatewayError) {
      return NextResponse.json(
        { ok: false, error: "gateway_error", detail: err.raw },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : "status_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export const POST = GET;
