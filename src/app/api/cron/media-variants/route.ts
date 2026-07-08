import { NextResponse } from "next/server";
import { hasBearerSecret } from "@/lib/security/bearer";
import { logOperationalError } from "@/lib/monitoring";
import { runVariantBackfill } from "@/lib/media/variant-backfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Variant generation is CPU/memory heavy (sharp). Give it more headroom than a
// default function and keep the per-invocation batch small.
export const maxDuration = 60;

/**
 * Hands-off variant backfill. Schedule a few minutes after `xml-import` so
 * newly imported products get thumb/card/pdp WebP without manual steps. Each
 * call processes a small batch and reports how many rows remain, so a scheduler
 * (or repeated calls) drains the backlog; large imports may take several runs.
 *
 * For a big one-time catchup, prefer the standalone worker
 * (`npm run media:backfill`) on a real Node process — serverless has tighter
 * memory/time limits.
 *
 * Auth: shared `CRON_SECRET` bearer, matching /api/cron/xml-import.
 */
function isAuthorized(req: Request): boolean {
  return hasBearerSecret(req, process.env.CRON_SECRET);
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 50)
    : 20;
  try {
    const result = await runVariantBackfill(limit);
    if (!result.ok) {
      return NextResponse.json(result, { status: 503 });
    }
    return NextResponse.json(result);
  } catch (err) {
    logOperationalError("media.variants.backfill.failed", err, { limit });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
