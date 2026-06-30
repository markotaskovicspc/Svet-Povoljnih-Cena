import { NextResponse } from "next/server";
import { getXExpressConfig } from "@/lib/x-express/config";
import { syncXExpressDictionaries } from "@/lib/x-express/sync";
import { hasBearerSecret } from "@/lib/security/bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request) {
  return hasBearerSecret(req, getXExpressConfig().statusCronSecret);
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const summary = await syncXExpressDictionaries();
  return NextResponse.json({ ok: true, summary });
}

export const GET = run;
export const POST = run;
