import { NextResponse } from "next/server";
import {
  isRabaluxEnabled,
  RabaluxSyncBusyError,
  syncPendingRabaluxMedia,
} from "@/lib/rabalux";
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
  const limit = Math.min(
    Math.max(Number(new URL(request.url).searchParams.get("limit")) || 100, 1),
    500,
  );
  try {
    return NextResponse.json({
      ok: true,
      summary: await syncPendingRabaluxMedia(limit),
    });
  } catch (error) {
    if (error instanceof RabaluxSyncBusyError) {
      return NextResponse.json(
        { ok: true, skipped: "already_running" },
        { status: 202 },
      );
    }
    logOperationalError("rabalux.media.failed", error);
    return NextResponse.json(
      { ok: false, error: "Rabalux media synchronization failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
