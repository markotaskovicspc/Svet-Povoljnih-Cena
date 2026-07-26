import { NextResponse } from "next/server";
import {
  isXExpressWebhookContractValid,
  parseXExpressWebhookBatch,
  processXExpressWebhookNotifyIds,
  stageXExpressWebhookBatch,
  verifyXExpressWebhookHeaders,
} from "@/lib/x-express/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!verifyXExpressWebhookHeaders(req.headers)) {
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
  await processXExpressWebhookNotifyIds(
    batch.map((item) => item.NotifyId),
  );
  // X Express explicitly expects an empty HTTP 200 response. Processing is
  // idempotent by NotifyId, so a provider retry is safe after a timeout.
  return new NextResponse(null, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhookUrl: "https://www.svetpovoljnihcena.rs/api/x-express/webhook",
  });
}
