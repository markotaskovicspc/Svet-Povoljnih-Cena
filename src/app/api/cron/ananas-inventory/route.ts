import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { advanceAnanasInventoryHistory } from "@/lib/ananas/inventory-history.server";
import { getAnanasInventoryPolicy } from "@/lib/ananas/inventory.server";
import { ananasError } from "@/lib/ananas/sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req, undefined)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const policy = await getAnanasInventoryPolicy();
  if (!policy?.enabled || (policy.leaseUntil && new Date(policy.leaseUntil) > new Date())) return NextResponse.json({ ok: true, skipped: true });
  try { const result = await advanceAnanasInventoryHistory(); console.info("ananas.inventory.progress", result); return NextResponse.json({ ok: true, ...result }); }
  catch (error) { return NextResponse.json({ ok: false, error: ananasError(error) }, { status: 502 }); }
}
