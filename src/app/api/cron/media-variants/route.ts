import { NextResponse, after } from "next/server";
import { hasBearerSecret } from "@/lib/security/bearer";
import { logOperationalError } from "@/lib/monitoring";
import { runVariantBackfill } from "@/lib/media/variant-backfill";
import { triggerVariantBackfill } from "@/lib/media/trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Variant generation is CPU/memory heavy (sharp). Give it more headroom than a
// default function; the drain loop below stays under DRAIN_BUDGET_MS.
export const maxDuration = 60;

// Stop draining a few seconds short of maxDuration and hand off to a fresh
// invocation, so sharp work never gets killed mid-flight.
const DRAIN_BUDGET_MS = 45_000;

/**
 * Event-driven variant backfill. Triggered when an import finishes (see
 * /api/cron/xml-import and the Book12 script) — NOT on a fixed timer. Each call
 * returns immediately (202) and drains in the background via `after()`:
 * processes batches until nothing is missing or the time budget is hit, then
 * self-continues in a fresh invocation. The chain self-terminates when the DB
 * has no image rows missing variants, and stops early if a batch makes no
 * progress (only permanently-failing rows left) to avoid an infinite loop.
 *
 * Pass `?wait=1` to drain synchronously and get the result back (handy for
 * manual runs / verification).
 *
 * Auth: shared `CRON_SECRET` bearer, matching /api/cron/xml-import.
 */
function isAuthorized(req: Request): boolean {
  return hasBearerSecret(req, process.env.CRON_SECRET);
}

async function drain(limit: number, origin: string) {
  const start = Date.now();
  let result = await runVariantBackfill(limit);
  if (!result.ok) return result;
  let progressed = result.updated > 0;
  while (
    result.remaining > 0 &&
    progressed &&
    Date.now() - start < DRAIN_BUDGET_MS
  ) {
    const before = result.remaining;
    result = await runVariantBackfill(limit);
    if (!result.ok) break;
    progressed = result.remaining < before;
  }
  // Still work left AND we were making progress ⇒ we stopped on the time
  // budget, so continue in a fresh invocation. If we stopped because a batch
  // made no progress, don't continue (would spin on failing rows forever).
  if (result.ok && result.remaining > 0 && progressed) {
    await triggerVariantBackfill(origin, limit);
  }
  return result;
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
  const origin = url.origin;

  // Synchronous mode for manual runs / verification.
  if (url.searchParams.get("wait") === "1") {
    try {
      const result = await drain(limit, origin);
      return NextResponse.json(result, { status: result.ok ? 200 : 503 });
    } catch (err) {
      logOperationalError("media.variants.backfill.failed", err, { limit });
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }

  // Default: return fast, drain in the background so callers (the import route)
  // never block on image processing.
  after(async () => {
    try {
      await drain(limit, origin);
    } catch (err) {
      logOperationalError("media.variants.backfill.failed", err, { limit });
    }
  });
  return NextResponse.json({ ok: true, scheduled: true, limit }, { status: 202 });
}

export const GET = run;
export const POST = run;
