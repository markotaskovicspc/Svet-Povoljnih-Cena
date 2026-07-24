import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { getSalesOrderProduct } from "@/lib/admin/sales-order.server";

export async function GET(request: Request) {
  await requireAdminAction(["OPS"]);
  const search = new URL(request.url).searchParams;
  try {
    const product = await getSalesOrderProduct(
      search.get("sku") ?? "",
      search.get("priceListId") ?? "",
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
