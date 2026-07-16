import { NextResponse } from "next/server";
import { processPendingBackgroundJobs } from "@/lib/background-jobs";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function run(req: Request) {
  if (!isAuthorizedCronRequest(req, process.env.BACKGROUND_JOBS_CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20, 1), 100);
  const summary = await processPendingBackgroundJobs(limit);
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
