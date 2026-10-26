import { NextResponse } from "next/server";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { articleSearchWhere } from "@/lib/admin/article-search";
import { productLabelsRequest } from "@/lib/admin/product-labels";
import { buildProductLabelsPdf, ProductLabelError, productLabelArticle, productLabelSelect } from "@/lib/admin/product-labels.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const privateHeaders = { "cache-control": "private, no-store, max-age=0" };

export async function GET(request: Request) {
  await requireAdminAction(["CONTENT", "OPS"], "/admin/erp/nalepnice");
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return NextResponse.json({ articles: [] }, { headers: privateHeaders });
  const products = await db.product.findMany({
    where: articleSearchWhere(q), select: productLabelSelect, orderBy: { sku: "asc" }, take: 20,
  });
  return NextResponse.json({ articles: products.map(productLabelArticle) }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  await requireAdminAction(["CONTENT", "OPS"], "/admin/erp/nalepnice");
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Neispravan zahtev za štampu." }, { status: 400, headers: privateHeaders }); }
  const parsed = productLabelsRequest.safeParse(payload);
  if (!parsed.success) {
    const message = parsed.error.issues.find(issue => issue.code === "custom")?.message ?? "Izaberite artikle, ceo broj nalepnica i početnu poziciju od 1 do 24.";
    return NextResponse.json({ error: message }, { status: 400, headers: privateHeaders });
  }
  const products = await db.product.findMany({
    where: { id: { in: parsed.data.items.map(item => item.productId) } }, select: productLabelSelect,
  });
  const byId = new Map(products.map(product => [product.id, product]));
  if (parsed.data.items.some(item => !byId.has(item.productId))) {
    return NextResponse.json({ error: "Izabrani artikal više ne postoji. Osvežite izbor." }, { status: 404, headers: privateHeaders });
  }
  try {
    // Resolve all printed values from current catalogue data, never from client-supplied text.
    const pdf = await buildProductLabelsPdf(parsed.data.items.map(item => ({
      article: productLabelArticle(byId.get(item.productId)!), copies: item.copies,
    })), parsed.data.startPosition);
    return new NextResponse(new Uint8Array(pdf), { headers: {
      ...privateHeaders, "content-type": "application/pdf",
      "content-disposition": 'inline; filename="nalepnice-za-kutije-a4.pdf"',
      "x-content-type-options": "nosniff",
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ProductLabelError ? error.message : "PDF trenutno nije moguće pripremiti. Pokušajte ponovo." }, {
      status: error instanceof ProductLabelError ? 422 : 500, headers: privateHeaders,
    });
  }
}
