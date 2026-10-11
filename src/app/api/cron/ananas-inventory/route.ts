import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { advanceAnanasInventoryHistory } from "@/lib/ananas/inventory-history.server";
import { getAnanasInventoryPolicy, getAnanasInventoryStatus } from "@/lib/ananas/inventory.server";
import { ananasError } from "@/lib/ananas/sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req, undefined)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (new URL(req.url).searchParams.get("status") === "1") {
    const status = await getAnanasInventoryStatus();
    const articlesForSupplierSetup = new URL(req.url).searchParams.get("articles") === "1"
      ? await db.$queryRaw<Array<{ sku: string; name: string }>>`
          SELECT p.sku, p.name FROM "Product" p
          WHERE p."isActive" = false AND p."deletedAt" IS NULL AND p."supplierId" IS NULL
            AND p."availableWebManual" = false AND p."availableWholesaleManual" = false AND p."availableExportManual" = false
            AND p.sku ~ '^[0-9]{6}$'
            AND EXISTS (
              SELECT 1 FROM "AnanasDocument" d, jsonb_array_elements(d.items) i
              WHERE d."issuedAt" >= '2025-05-31T22:00:00Z'::timestamptz
                AND CASE WHEN trim(i->>'sku') ~ '^[0-9]{4}$'
                  THEN substring(trim(i->>'sku') from 1 for 1) || '10' || substring(trim(i->>'sku') from 2)
                  ELSE trim(i->>'sku') END = p.sku
            ) ORDER BY p.sku`
      : undefined;
    return NextResponse.json({ ok: true, posted: status.posted, pending: status.pending, errors: status.errors,
      negatives: status.negatives, historyThrough: status.policy?.historyThrough ?? null, windowHours: status.policy?.historyWindowHours ?? 72, articlesForSupplierSetup });
  }
  const policy = await getAnanasInventoryPolicy();
  if (!policy?.enabled || (policy.leaseUntil && new Date(policy.leaseUntil) > new Date())) return NextResponse.json({ ok: true, skipped: true });
  try { const result = await advanceAnanasInventoryHistory(); console.info("ananas.inventory.progress", result); return NextResponse.json({ ok: true, ...result }); }
  catch (error) { return NextResponse.json({ ok: false, error: ananasError(error) }, { status: 502 }); }
}
