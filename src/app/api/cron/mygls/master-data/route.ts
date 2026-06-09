import { NextResponse } from "next/server";
import { getMyGlsConfig, syncMyGlsMasterData } from "@/lib/mygls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  const expected = getMyGlsConfig().statusCronSecret;
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
  const summary = await syncMyGlsMasterData();
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
