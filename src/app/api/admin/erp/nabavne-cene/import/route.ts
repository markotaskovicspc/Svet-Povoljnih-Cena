import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { MAX_PURCHASE_PRICE_IMPORT_BYTES, PURCHASE_PRICE_IMPORT_HEADERS } from "@/lib/admin/purchase-price-import";
import { applyPurchasePriceImport, previewPurchasePriceImport, readPurchasePriceImportFile } from "@/lib/admin/purchase-price-import.server";
import { createInventoryImportToken } from "@/lib/admin/inventory-import-token";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET() {
  await requireAdminAction(allowedRolesForErpModule("nabavne-cene"), "/admin/erp/nabavne-cene");
  return new Response(`\uFEFF${PURCHASE_PRICE_IMPORT_HEADERS.join(";")}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="nabavne-cene-sablon.csv"', "Cache-Control": "no-store" },
  });
}

async function boundedFormData(request: Request) {
  const limit = MAX_PURCHASE_PRICE_IMPORT_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new Error("Datoteka je prevelika. Najviše 2 MB.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Nedostaje datoteka.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("Datoteka je prevelika. Najviše 2 MB."); }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
}

export async function POST(request: Request) {
  const admin = await requireAdminAction(allowedRolesForErpModule("nabavne-cene"), "/admin/erp/nabavne-cene");
  const origin = request.headers.get("origin");
  // Next's development server may rewrite request.url to localhost while the
  // browser and HTTP Host correctly use 127.0.0.1. Host is the actual request
  // target; do not trust an arbitrary forwarded-host override from the client.
  const url = new URL(request.url);
  const requestOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (origin && origin !== requestOrigin) return NextResponse.json({ ok: false, error: "Nedozvoljen izvor zahteva." }, { status: 403 });
  try {
    const form = await boundedFormData(request);
    const file = form.get("file");
    const action = form.get("action");
    if (!(file instanceof File)) throw new Error("Izaberite CSV ili XLSX datoteku.");
    if (action !== "preview" && action !== "apply") throw new Error("Nepoznata operacija.");
    const parsed = await readPurchasePriceImportFile(file);
    if (action === "preview") {
      const result = await db.$transaction(tx => previewPurchasePriceImport(tx, parsed.rows), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
      const preview = { rows: result.rows, stateHash: result.stateHash, valid: result.valid };
      const token = preview.valid ? createInventoryImportToken({ adminId: `purchase-prices:${admin.id}`, fileHash: parsed.fileHash, stateHash: preview.stateHash }) : null;
      return NextResponse.json({ ok: true, ...preview, token });
    }
    const token = form.get("token");
    if (typeof token !== "string" || !token || token.length > 2048) throw new Error("Prvo pregledajte datoteku, pa potvrdite uvoz.");
    const result = await applyPurchasePriceImport({ ...parsed, token, adminId: admin.id });
    revalidatePath("/admin/erp/nabavne-cene");
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ ok: false, error: error.code === "P2034" ? "Podaci su istovremeno promenjeni. Ponovite pregled i pokušajte ponovo." : "Uvoz nije sačuvan. Proverite podatke i ponovite pregled." }, { status: 409 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Uvoz nije uspeo." }, { status: 400 });
  }
}
