import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { startContactImport, importContactBatch } from "@/lib/newsletter/import-session";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const admin = await requireAdminAction(["ADS"]);
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Nedozvoljen izvor zahteva." }, { status: 403 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 2_500_000) return NextResponse.json({ error: "Paket je prevelik." }, { status: 413 });
  try {
    const body = JSON.parse(raw);
    const result = body.operation === "start" ? await startContactImport(body, admin.id)
      : body.operation === "batch" ? await importContactBatch(body, admin.id) : null;
    if (!result) throw new Error("Nepoznata operacija uvoza.");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Uvoz nije uspeo. Možete nastaviti bez dupliranja." }, { status: 400 });
  }
}
