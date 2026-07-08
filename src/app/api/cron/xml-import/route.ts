import { NextResponse, after } from "next/server";
import { importAllSuppliers, importSupplier } from "@/lib/xml";
import { hasBearerSecret } from "@/lib/security/bearer";
import { logOperationalError } from "@/lib/monitoring";
import { triggerVariantBackfill } from "@/lib/media/trigger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase 4A scheduled entrypoint. Triggered by the platform cron (Vercel
 * cron, external scheduler, GitHub Actions — all fine) every 15 minutes.
 *
 * Authentication: shared `CRON_SECRET` carried in the `Authorization`
 * header. We deliberately avoid relying on Vercel's built-in cron
 * signature so the same endpoint works under self-hosting, and so manual
 * re-runs from the admin dashboard (Phase 5) can use the same path with
 * a `supplierId` query param.
 */

function isAuthorized(req: Request): boolean {
  // Fail-closed: if the secret isn't configured the route is unusable.
  return hasBearerSecret(req, process.env.CRON_SECRET);
}

/**
 * Event-driven kick: when a real (non-dry-run) import created or updated any
 * products, their fresh ProductMedia rows have no variants yet, so start the
 * worker now. `after()` runs it once the import response is sent; the worker
 * self-drains from there. Fire-and-forget — never blocks or fails the import.
 */
function maybeTriggerVariants(
  origin: string,
  dryRun: boolean,
  summaries: Array<{ created?: number; updated?: number }>,
): void {
  if (dryRun) return;
  const changed = summaries.reduce(
    (sum, s) => sum + (s.created ?? 0) + (s.updated ?? 0),
    0,
  );
  if (changed <= 0) return;
  after(() => triggerVariantBackfill(origin));
}

async function run(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const supplierId = url.searchParams.get("supplierId");
  const dryRun = url.searchParams.get("dryRun") === "1";
  try {
    if (supplierId) {
      const summary = await importSupplier(supplierId, { dryRun });
      maybeTriggerVariants(url.origin, dryRun, [summary]);
      return NextResponse.json({ ok: true, summary });
    }
    const summaries = await importAllSuppliers({ dryRun });
    maybeTriggerVariants(url.origin, dryRun, summaries);
    return NextResponse.json({ ok: true, summaries });
  } catch (err) {
    logOperationalError("import.xml.failed", err, { supplierId, dryRun });
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// Vercel cron uses GET; manual admin re-runs use POST. Both behave the
// same way — auth + dispatch.
export const GET = run;
export const POST = run;
