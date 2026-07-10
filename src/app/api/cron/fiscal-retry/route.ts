import { NextResponse } from "next/server";
import { retryPendingFiscalDocuments } from "@/lib/fiscal/retry";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  return isAuthorizedCronRequest(req, process.env.FISCAL_RETRY_CRON_SECRET);
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 25) || 25, 1),
    100,
  );
  const summary = await retryPendingFiscalDocuments(limit);
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
