import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { ananasConfigured } from "@/lib/ananas/client";
import { ananasError } from "@/lib/ananas/sync";
import { syncAnanasOrdersAutomatically } from "@/lib/ananas/orders-sync";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req, undefined)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ananasConfigured()) return NextResponse.json({ error: "Ananas pristup nije podešen." }, { status: 503 });
  try { return NextResponse.json({ ok: true, ...await syncAnanasOrdersAutomatically() }); }
  catch (error) { return NextResponse.json({ ok: false, error: ananasError(error) }, { status: 502 }); }
}
