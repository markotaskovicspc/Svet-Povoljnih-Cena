import { NextResponse } from "next/server";
import { getEmailConfig, syncResendMarketingContacts } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const expected = getEmailConfig().alertsCronSecret;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${expected}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === expected;
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
