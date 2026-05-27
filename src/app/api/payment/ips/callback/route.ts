import { NextResponse } from "next/server";
import { ipsPaymentProvider, IpsConfigError } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const payload = await readPayload(req);
  try {
    const result = await ipsPaymentProvider.handleCallback(payload);
    return NextResponse.json({ ok: true, paid: result.paid });
  } catch (err) {
    if (err instanceof IpsConfigError) {
      return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "invalid_callback";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

async function readPayload(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return req.json().catch(() => ({}));
  const params = new URLSearchParams(await req.text());
  return Object.fromEntries(params.entries());
}
