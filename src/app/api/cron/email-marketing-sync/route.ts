import { NextResponse } from "next/server";
import { getEmailConfig, syncResendMarketingContacts } from "@/lib/email";
import { hasBearerSecret } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  return hasBearerSecret(req, getEmailConfig().alertsCronSecret);
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 500) || 500, 1),
    1000,
  );
  const summary = await syncResendMarketingContacts(limit);
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
