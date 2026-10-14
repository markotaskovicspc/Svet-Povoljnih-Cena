import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { isMorningPickingTime } from "@/lib/admin/picking-review";
import { createPickupBatch, loadEligibleOrders } from "@/lib/admin/pickup-batch.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request, process.env.PICKING_CRON_SECRET)) return NextResponse.json({ ok: false }, { status: 401 });
  // Both UTC hours are scheduled; only the Serbian 04:00 invocation runs (DST).
  if (!isMorningPickingTime(new Date())) return NextResponse.json({ ok: true, skipped: true });
  const actor = await db.adminUser.findFirst({ where: { enabled: true, role: { in: ["SUPER", "OPS"] } }, orderBy: { id: "asc" }, select: { id: true } });
  if (!actor) return NextResponse.json({ ok: false, error: "Nema aktivnog administratora za pripremu pickinga." }, { status: 503 });
  const results = [];
  for (const provider of ["MYGLS", "X_EXPRESS"] as const) {
    try {
      // Existing collection locks reuse editable drafts and prevent duplicate packages.
      const batch = await createPickupBatch(provider);
      const loaded = await loadEligibleOrders(batch.id, actor.id);
      results.push({ provider, batchId: batch.id, ok: true, loaded });
    } catch (error) {
      console.error("[warehouse-picking] Preparation failed", provider, error);
      results.push({ provider, ok: false });
    }
  }
  const ok = results.every(result => result.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 503 });
}
