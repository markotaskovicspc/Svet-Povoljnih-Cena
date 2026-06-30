import { NextResponse } from "next/server";
import {
  parseXExpressWebhookBatch,
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
  return new NextResponse("", { status: 200 });
}
