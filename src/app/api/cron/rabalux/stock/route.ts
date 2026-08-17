import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: Request) {
  if (!isAuthorizedCronRequest(request, null)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    skipped: "weekly_serbia_xlsx_is_authoritative",
  });
}

export const GET = run;
export const POST = run;
