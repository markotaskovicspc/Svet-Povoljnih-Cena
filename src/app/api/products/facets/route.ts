import { NextResponse } from "next/server";
import { listProductFacets } from "@/lib/api/catalog";
import { parseListProductsInput } from "@/lib/api/product-query";
import { logOperationalError } from "@/lib/monitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const input = parseListProductsInput(searchParams);
    const result = await listProductFacets(input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logOperationalError("api.products.facets_failed", error, {
      query: Object.fromEntries(searchParams.entries()),
    });
    return NextResponse.json(
      { ok: false, error: "product_facets_unavailable" },
      { status: 500 },
    );
  }
}
