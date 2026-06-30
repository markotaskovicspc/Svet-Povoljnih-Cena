import { NextResponse } from "next/server";
import {
  ipsPaymentProvider,
  IpsConfigError,
  verifyIpsCallbackRequest,
} from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    verifyIpsCallbackRequest(req, rawBody);
    const payload = readPayload(req, rawBody);
    const result = await ipsPaymentProvider.handleCallback(payload);
    return NextResponse.json({ ok: true, paid: result.paid });
  } catch (err) {
    if (err instanceof IpsConfigError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    console.error("[ips] callback rejected", err);
    return NextResponse.json({ ok: false, error: "invalid_callback" }, { status: 400 });
  }
}

function readPayload(req: Request, rawBody: string): unknown {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(rawBody);
  return Object.fromEntries(params.entries());
}
