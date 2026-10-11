import { NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/security/bearer";
import { ananasConfigured } from "@/lib/ananas/client";
import { ananasError, syncAnanasAutomatically } from "@/lib/ananas/sync";
import { postPendingAnanasInventory } from "@/lib/ananas/inventory.server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  const deadline = Date.now() + 210000;
  if (!isAuthorizedCronRequest(req, undefined)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!ananasConfigured()) return NextResponse.json({ ok: false, error: "Ananas pristup nije podešen." }, { status: 503 });
  try { const documents = await syncAnanasAutomatically(); return NextResponse.json({ ok: true, ...documents, inventory: await postPendingAnanasInventory(40, undefined, deadline) }); }
  catch (error) {
    const message = ananasError(error);
    console.error("ananas.sync.failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
