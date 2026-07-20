import type {
  ListProductsInput,
  ProductSort,
} from "@/lib/api/catalog";

const SORTS = new Set<ProductSort>([
  "default",
  "price-asc",
  "price-desc",
  "discount-desc",
]);

export function parseListProductsInput(
  searchParams: URLSearchParams,
): ListProductsInput {
  const limit = number(searchParams, "limit") ?? 36;
  const sort = searchParams.get("sort");

  return {
    categoryPath: text(searchParams, "categoryPath"),
    actionSlug: text(searchParams, "actionSlug"),
    groupSlug: text(searchParams, "groupSlug"),
    collectionSlug: text(searchParams, "collectionSlug"),
    cursor: text(searchParams, "cursor"),
    limit,
    maxPrice: number(searchParams, "maxPrice"),
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

function number(searchParams: URLSearchParams, key: string) {
  const value = text(searchParams, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(searchParams: URLSearchParams, key: string) {
  return searchParams.get(key) === "true" || searchParams.get(key) === "1";
}
