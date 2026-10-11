import { NextResponse } from "next/server";
import { getEmailConfig } from "@/lib/email/config";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { processRestockWaitlist } from "@/lib/email/restock";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req, getEmailConfig().alertsCronSecret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, summary: await processRestockWaitlist(200) });
}
