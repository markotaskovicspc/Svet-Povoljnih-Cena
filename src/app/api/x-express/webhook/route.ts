import { NextResponse } from "next/server";
import {
  isXExpressWebhookContractValid,
  parseXExpressWebhookBatch,
  stageXExpressWebhookBatch,
  verifyXExpressWebhookHeaders,
} from "@/lib/x-express/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!verifyXExpressWebhookHeaders(req.headers)) {
    console.warn("[X Express webhook] Authentication rejected.", {
      hasApiKey: Boolean(req.headers.get("x-api-key")),
      hasBearer: /^Bearer\s+\S+/i.test(req.headers.get("authorization") ?? ""),
      senderMatches: req.headers.get("x-api-sender") === "XExpress",
    });
    return new NextResponse("", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  let batch;
  try {
    batch = parseXExpressWebhookBatch(body);
  } catch {
    return new NextResponse("", { status: 400 });
  }
  if (!isXExpressWebhookContractValid(batch)) {
    return new NextResponse("", { status: 400 });
  }

  await stageXExpressWebhookBatch(batch);
  // X Express explicitly requires a fast, empty HTTP 200 response. The event
  // is only staged here; the cron/background processor interprets it later.
  // NotifyId is unique, so provider retries remain idempotent.
  return new NextResponse(null, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhookUrl: "https://www.svetpovoljnihcena.rs/api/x-express/webhook",
  });
}
