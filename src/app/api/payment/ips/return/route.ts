import { NextResponse } from "next/server";
import { ipsPaymentProvider, getIpsConfig } from "@/lib/payments";
import { rotateOrderAccessToken } from "@/lib/api/order-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const order = url.searchParams.get("order");
  const result = url.searchParams.get("result");
  if (!order) return await redirectFinal({ order: null, status: "error" });

  if (result !== "cancel") {
    try {
      const status = await ipsPaymentProvider.checkPaymentStatus(order);
      return await redirectFinal({
        order,
        status: status.paid ? "paid" : result === "success" ? "checking" : "failed",
      });
    } catch (err) {
      console.error("[ips] return status check failed", err);
      return await redirectFinal({
        order,
        status: result === "fail" ? "failed" : result === "cancel" ? "cancel" : "checking",
      });
    }
  }

  return await redirectFinal({ order, status: "cancel" });
}

async function redirectFinal(args: {
  order: string | null;
  status: "paid" | "failed" | "cancel" | "checking" | "error";
}) {
  const base = (() => {
    try {
      return getIpsConfig().publicBaseUrl;
    } catch {
      return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    }
  })();
  const target = new URL(args.order ? "/checkout/potvrda" : "/korpa", base);
  if (args.order) {
    target.searchParams.set("order", args.order);
    const token = await rotateOrderAccessToken(args.order).catch((err) => {
      console.error("[order-access] IPS return token rotation failed", err);
      return null;
    });
    if (token) target.searchParams.set("token", token);
  }
  target.searchParams.set("status", args.status);
  return NextResponse.redirect(target, { status: 303 });
}
