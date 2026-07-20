import { NextResponse } from "next/server";
import { isRabaluxEnabled, syncRabaluxStock } from "@/lib/rabalux";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { logOperationalError } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(request: Request) {
  if (!isAuthorizedCronRequest(request, null)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isRabaluxEnabled()) {
    return NextResponse.json({ ok: true, skipped: "integration_disabled" });
  }
  try {
    return NextResponse.json({ ok: true, summary: await syncRabaluxStock() });
  } catch (error) {
    logOperationalError("rabalux.stock.failed", error);
    return NextResponse.json(
      { ok: false, error: "Rabalux stock synchronization failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
