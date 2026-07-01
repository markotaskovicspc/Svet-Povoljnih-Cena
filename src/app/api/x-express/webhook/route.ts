import { NextResponse } from "next/server";
import {
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

  await stageXExpressWebhookBatch(batch);
  const summary = await processXExpressWebhookNotifyIds(
    batch.map((item) => item.NotifyId),
  );
  return NextResponse.json({
    ok: true,
    received: batch.length,
    processed: summary.processed,
    failed: summary.failed,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webhookUrl: "https://svetpovoljnihcena.rs/api/x-express/webhook",
  });
}
