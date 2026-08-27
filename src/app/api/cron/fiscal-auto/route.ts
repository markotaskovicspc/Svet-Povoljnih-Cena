import { NextResponse } from "next/server";
import { enqueueEligibleOrdersForFiscalization } from "@/lib/fiscal/auto-reconcile";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request) {
  if (!isAuthorizedCronRequest(req, process.env.FISCAL_AUTO_CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const requestedLimit = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  const summary = await enqueueEligibleOrdersForFiscalization(requestedLimit);
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
