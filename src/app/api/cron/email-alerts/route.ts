import { NextResponse } from "next/server";
import { getEmailConfig } from "@/lib/email";
import { processEmailAlerts } from "@/lib/email/alerts";
import { processUrgentAdminAlerts } from "@/lib/email/admin-alerts";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  return isAuthorizedCronRequest(req, getEmailConfig().alertsCronSecret);
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
  const [customer, admin] = await Promise.all([
    processEmailAlerts(limit),
    processUrgentAdminAlerts(),
  ]);
  return NextResponse.json({ ok: true, summary: { customer, admin } });
}

export const GET = run;
export const POST = run;
