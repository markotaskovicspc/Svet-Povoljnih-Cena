import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { getDispatchNoteProduct } from "@/lib/admin/dispatch-note.server";

export async function GET(request: Request) {
  await requireAdminAction(["OPS"]);
  const search = new URL(request.url).searchParams;
  try {
    const product = await getDispatchNoteProduct(
      search.get("sku") ?? "",
      search.get("priceListId") ?? "",
      search.get("internal") === "true",
    );
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Artikal nije učitan.",
      },
      { status: 400 },
    );
  }
}
