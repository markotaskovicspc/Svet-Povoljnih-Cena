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
    permanentOnly: bool(searchParams, "permanentOnly"),
    groupSlug: text(searchParams, "groupSlug"),
    collectionSlug: text(searchParams, "collectionSlug"),
    categoryKeyword: text(searchParams, "categoryKeyword"),
    nameKeyword: text(searchParams, "nameKeyword"),
    groupSlugs: list(searchParams, "groups"),
    materialLabels: list(searchParams, "materials"),
    colors: list(searchParams, "colors"),
    attributes: list(searchParams, "attributes"),
    availability: availability(searchParams),
    dynamicFilters: dynamicFilters(searchParams),
    cursor: text(searchParams, "cursor"),
    limit,
    maxPrice: number(searchParams, "maxPrice"),
    priceRange: range(searchParams, "priceMin", "priceMax"),
    widthRange: range(searchParams, "widthMin", "widthMax"),
    depthRange: range(searchParams, "depthMin", "depthMax"),
    heightRange: range(searchParams, "heightMin", "heightMax"),
    sort: sort && SORTS.has(sort as ProductSort) ? (sort as ProductSort) : undefined,
    onSaleOnly: bool(searchParams, "onSaleOnly"),
    heroOnly: bool(searchParams, "heroOnly"),
    newOnly: bool(searchParams, "newOnly"),
    limitedOnly: bool(searchParams, "limitedOnly"),
    outletOnly: bool(searchParams, "outletOnly"),
  };
}

function list(searchParams: URLSearchParams, key: string) {
  const values = searchParams
    .getAll(key)
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length ? Array.from(new Set(values)) : undefined;
}

function range(
  searchParams: URLSearchParams,
  minKey: string,
  maxKey: string,
): [number, number] | undefined {
  const min = number(searchParams, minKey);
  const max = number(searchParams, maxKey);
  if (min === undefined || max === undefined || min > max) return undefined;
  return [min, max];
}

function availability(searchParams: URLSearchParams) {
  const allowed = new Set(["in-stock", "incoming", "out-of-stock"] as const);
  const values = searchParams
    .getAll("availability")
    .filter((value): value is "in-stock" | "incoming" | "out-of-stock" =>
      allowed.has(value as "in-stock" | "incoming" | "out-of-stock"),
    );
  return values.length ? Array.from(new Set(values)) : undefined;
}

function dynamicFilters(searchParams: URLSearchParams) {
  const result: Record<string, string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    if (!key.startsWith("dynamic.")) continue;
    const facetKey = key.slice("dynamic.".length).trim();
    if (!facetKey) continue;
    const values = list(searchParams, key);
    if (values?.length) result[facetKey] = values;
  }
  return Object.keys(result).length ? result : undefined;
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
