import { NextResponse } from "next/server";
import { getXExpressConfig } from "@/lib/x-express/config";
import { syncXExpressShipmentStatuses } from "@/lib/x-express/sync";
import { processXExpressWebhookEvents } from "@/lib/x-express/webhook";
import { hasBearerSecret } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  return hasBearerSecret(req, getXExpressConfig().statusCronSecret);
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1),
    500,
  );
  const cfg = getXExpressConfig();
  const summary = cfg.paths.status
    ? await syncXExpressShipmentStatuses(limit)
    : await processXExpressWebhookEvents(limit);
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
