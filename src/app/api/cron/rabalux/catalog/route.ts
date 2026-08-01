import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import {
  isRabaluxEnabled,
  RabaluxSyncBusyError,
  syncRabaluxCatalog,
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
  try {
    const summary = await syncRabaluxCatalog();
    revalidateTag("catalog-products", "max");
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    if (error instanceof RabaluxSyncBusyError) {
      return NextResponse.json(
        { ok: true, skipped: "already_running" },
        { status: 202 },
      );
    }
    logOperationalError("rabalux.catalog.failed", error);
    return NextResponse.json(
      { ok: false, error: "Rabalux catalog synchronization failed." },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
