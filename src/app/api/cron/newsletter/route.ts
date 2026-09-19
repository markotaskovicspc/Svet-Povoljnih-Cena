import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { processBackgroundJob } from "@/lib/background-jobs";
import { enqueueDueNewsletterCampaigns } from "@/lib/newsletter/campaigns";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req, process.env.BACKGROUND_JOBS_CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await enqueueDueNewsletterCampaigns();
  const now = new Date();
  const job = await db.backgroundJob.findFirst({
    where: {
      kind: "NEWSLETTER_CAMPAIGN_SEND", availableAt: { lte: now },
      OR: [{ status: { in: ["QUEUED", "RETRY"] } }, { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - 15 * 60_000) } }],
    },
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }], select: { id: true },
  });
  // processBackgroundJob atomically claims the job even if the general worker also sees it.
  return NextResponse.json({ ok: true, result: job ? await processBackgroundJob(job.id) : null });
}
