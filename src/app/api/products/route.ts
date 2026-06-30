import { NextResponse } from "next/server";
import {
  listProducts,
  type ListProductsInput,
  type ProductSort,
} from "@/lib/api/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS = new Set<ProductSort>([
  "default",
  "price-asc",
  "price-desc",
  "discount-desc",
]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const input = parseListProductsInput(searchParams);
    const result = await listProducts(input);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[api/products]", error);
    return NextResponse.json(
      { ok: false, items: [], nextCursor: null, total: 0 },
      { status: 200 },
    );
  }
}

function parseListProductsInput(searchParams: URLSearchParams): ListProductsInput {
  const limit = Number(searchParams.get("limit") ?? 36);
  const maxPrice = Number(searchParams.get("maxPrice"));
  const sort = searchParams.get("sort");

  return {
    categoryPath: text(searchParams, "categoryPath"),
    actionSlug: text(searchParams, "actionSlug"),
    groupSlug: text(searchParams, "groupSlug"),
    collectionSlug: text(searchParams, "collectionSlug"),
    cursor: text(searchParams, "cursor"),
    limit: Number.isFinite(limit) ? limit : 36,
    maxPrice: Number.isFinite(maxPrice) ? maxPrice : undefined,
    sort: sort && SORTS.has(sort as ProductSort) ? (sort as ProductSort) : undefined,
    onSaleOnly: bool(searchParams, "onSaleOnly"),
    heroOnly: bool(searchParams, "heroOnly"),
    newOnly: bool(searchParams, "newOnly"),
    limitedOnly: bool(searchParams, "limitedOnly"),
    outletOnly: bool(searchParams, "outletOnly"),
  };
}

function text(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key)?.trim();
  return value || undefined;
}

function bool(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) === "true" || searchParams.get(key) === "1";
}
