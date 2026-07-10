import { NextResponse } from "next/server";
import { getMyGlsConfig, syncMyGlsMasterData } from "@/lib/mygls";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  return isAuthorizedCronRequest(req, getMyGlsConfig().statusCronSecret);
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const summary = await syncMyGlsMasterData();
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
