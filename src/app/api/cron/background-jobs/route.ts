import { NextResponse } from "next/server";
import { processPendingBackgroundJobs } from "@/lib/background-jobs";
import { sweepReclamationAutoAccept } from "@/lib/admin/reclamation-auto-accept.server";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(req: Request) {
  if (!isAuthorizedCronRequest(req, process.env.BACKGROUND_JOBS_CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 20) || 20, 1), 100);
  // Reklamacije sa sajta koje čekaju odluku dobijaju posao automatskog prihvatanja (jednom po reklamaciji).
  let autoAcceptQueued = 0;
  try { autoAcceptQueued = await sweepReclamationAutoAccept(); } catch (error) { console.error("reclamation auto-accept sweep failed", error); }
  const summary = await processPendingBackgroundJobs(limit);
  return NextResponse.json({ ok: true, summary, autoAcceptQueued });
}

export const GET = run;
export const POST = run;
