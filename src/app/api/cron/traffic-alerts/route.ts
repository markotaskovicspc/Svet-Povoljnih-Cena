import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { evaluateTrafficAlert } from "@/lib/admin/traffic-push.server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request, process.env.CRON_SECRET)) return NextResponse.json({ ok: false }, { status: 401 });
  await evaluateTrafficAlert();
  await db.siteVisitorPresence.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - 24 * 3600_000) } } });
  return NextResponse.json({ ok: true });
}
