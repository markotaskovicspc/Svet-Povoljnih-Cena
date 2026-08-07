/**
 * Listing-page filter & sort helpers.
 *
 * All operations are pure and run on product DTOs returned by the catalog
 * read layer. Keep them dependency-free and total-fn (no throws).
 */
import type { Product } from "@/types";
import { isProductColorLabel } from "@/lib/product-colors";

export const LISTING_PAGE_SIZE = 36;

export type SortKey = "default" | "price-asc" | "price-desc" | "discount-desc";

export interface ListingSubTab {
  id: string;
  label: string;
  matchKeyword: string;
  matchField?: "category" | "name";
}

export function matchesListingSubTab(product: Product, tab: ListingSubTab) {
  const needle = tab.matchKeyword.toLocaleLowerCase("sr-Latn-RS");
  if (tab.matchField === "name") {
    return product.name.toLocaleLowerCase("sr-Latn-RS").includes(needle);
  }
  return product.categoryPath.some((segment) =>
    segment.toLocaleLowerCase("sr-Latn-RS").includes(needle),
  );
}

export type Availability = "in-stock" | "incoming" | "out-of-stock";

export interface DimensionRange {
  /** Width range Š (cm). */
  w?: [number, number];
  /** Depth range D (cm). */
  d?: [number, number];
  /** Height range V (cm). */
  h?: [number, number];
}

export interface FilterState {
  price?: [number, number];
  /** Selected product groups from the complete listing scope. */
  groups: string[];
  /** Selected materials (label keys). */
  materials: string[];
  /** Selected color tokens. */
  colors: string[];
  /** Selected free-form article attributes. */
  attributes: string[];
  dimensions?: DimensionRange;
  availability: Availability[];
  /** Per-group dynamic filters: facet key → set of values. */
  dynamic: Record<string, string[]>;
}

export const emptyFilterState = (): FilterState => ({
  groups: [],
  materials: [],
  colors: [],
  attributes: [],
  availability: [],
  dynamic: {},
});

/**
 * Adds the interactive listing state to the catalog API query. Repeated
 * parameters preserve labels that contain commas and keep OR semantics inside
 * each facet; the catalog combines different facets with AND semantics.
 */
export function appendFilterQueryParams(
  params: URLSearchParams,
  state: FilterState,
  sort: SortKey,
  categoryKeyword?: string,
) {
  const appendAll = (key: string, values: string[]) => {
    for (const value of values) params.append(key, value);
  };

  appendAll("groups", state.groups);
  appendAll("materials", state.materials);
  appendAll("colors", state.colors);
  appendAll("attributes", state.attributes);
  appendAll("availability", state.availability);

  if (state.price) {
    params.set("priceMin", String(state.price[0]));
    params.set("priceMax", String(state.price[1]));
  }
  if (state.dimensions?.w) {
    params.set("widthMin", String(state.dimensions.w[0]));
    params.set("widthMax", String(state.dimensions.w[1]));
  }
  if (state.dimensions?.d) {
    params.set("depthMin", String(state.dimensions.d[0]));
    params.set("depthMax", String(state.dimensions.d[1]));
  }
  if (state.dimensions?.h) {
    params.set("heightMin", String(state.dimensions.h[0]));
    params.set("heightMax", String(state.dimensions.h[1]));
  }
  for (const [key, values] of Object.entries(state.dynamic)) {
    appendAll(`dynamic.${key}`, values);
  }
  if (sort !== "default") params.set("sort", sort);
  if (categoryKeyword) params.set("categoryKeyword", categoryKeyword);
  return params;
}

/** Numeric extents (price + dimensions) needed to render the slider widgets. */
export interface FacetExtents {
  price: [number, number];
  width: [number, number];
  depth: [number, number];
  height: [number, number];
}

export function computeExtents(products: Product[]): FacetExtents {
  if (!products.length) {
    return {
      price: [0, 0],
      width: [0, 0],
      depth: [0, 0],
      height: [0, 0],
    };
  }
  const initial: FacetExtents = {
    price: [Infinity, -Infinity],
    width: [Infinity, -Infinity],
    depth: [Infinity, -Infinity],
    height: [Infinity, -Infinity],
  };
  for (const p of products) {
    const price = p.salePrice ?? p.fullPrice;
    initial.price = [Math.min(initial.price[0], price), Math.max(initial.price[1], price)];
    initial.width = [
      Math.min(initial.width[0], p.dimensionsCm.w),
      Math.max(initial.width[1], p.dimensionsCm.w),
    ];
    initial.depth = [
      Math.min(initial.depth[0], p.dimensionsCm.d),
      Math.max(initial.depth[1], p.dimensionsCm.d),
    ];
    initial.height = [
      Math.min(initial.height[0], p.dimensionsCm.h),
      Math.max(initial.height[1], p.dimensionsCm.h),
    ];
  }
  // Round to nice ends
  const round = (n: number, dir: "down" | "up", step = 10) =>
    dir === "down" ? Math.floor(n / step) * step : Math.ceil(n / step) * step;
  return {
    price: [round(initial.price[0], "down", 1000), round(initial.price[1], "up", 1000)],
    width: [round(initial.width[0], "down"), round(initial.width[1], "up")],
    depth: [round(initial.depth[0], "down"), round(initial.depth[1], "up")],
    height: [round(initial.height[0], "down"), round(initial.height[1], "up")],
  };
}

/** Distinct facet values discovered in the source list. */
export interface FacetValues {
  groups: string[];
  groupLabels: Record<string, string>;
  materials: string[];
  colors: string[];
  colorSwatches: Record<string, string>;
  attributes: string[];
  counts: {
    groups: Record<string, number>;
    materials: Record<string, number>;
    colors: Record<string, number>;
    attributes: Record<string, number>;
    availability: Record<Availability, number>;
  };
  /** Per-dynamic-key list of values present (alphabetical). */
  dynamic: Record<string, string[]>;
}

/**
 * Per-group dynamic facets — what extra filters to show besides the fixed ones.
 * Mirrors `Product.group`. Each entry produces a checkbox section.
 * Real values come from the XML feed in Phase 4; here we declare the facet key + label.
 */
export const DYNAMIC_FACETS_BY_GROUP: Record<
  string,
  { key: string; label: string; getValue: (p: Product) => string | undefined }[]
> = {
  "garderobni-ormari": [
    {
      key: "broj-vrata",
      label: "Broj vrata",
      // Heuristic: width / 50 cm ≈ door count. Replaced by feed value later.
      getValue: (p) => `${Math.max(2, Math.round(p.dimensionsCm.w / 50))} vrata`,
    },
  ],
  kreveti: [
    {
      key: "sirina-lezista",
      label: "Širina ležišta",
      getValue: (p) =>
        p.dimensionsCm.w >= 180
          ? "180 cm"
          : p.dimensionsCm.w >= 160
            ? "160 cm"
            : p.dimensionsCm.w >= 140
              ? "140 cm"
              : "≤ 120 cm",
    },
  ],
  garniture: [
    {
      key: "tip",
      label: "Tip garniture",
      getValue: (p) => (p.dimensionsCm.w >= 260 ? "Ugaona" : "Ravna"),
    },
  ],
};

export function dynamicFacetsForGroups(groups: string[]) {
  const out = new Map<string, { key: string; label: string; getValue: (p: Product) => string | undefined }>();
  for (const g of groups) {
    for (const f of DYNAMIC_FACETS_BY_GROUP[g] ?? []) {
      if (!out.has(f.key)) out.set(f.key, f);
    }
  }
  return Array.from(out.values());
}

export function computeFacetValues(products: Product[]): FacetValues {
  const groups = new Set<string>();
  const groupLabels: Record<string, string> = {};
  const materials = new Set<string>();
  const colors = new Set<string>();
  const colorSwatches: Record<string, string> = {};
  const attributes = new Set<string>();
  const dynamic: Record<string, Set<string>> = {};
  const counts = {
    groups: {} as Record<string, number>,
    materials: {} as Record<string, number>,
    colors: {} as Record<string, number>,
    attributes: {} as Record<string, number>,
    availability: {
      "in-stock": 0,
      incoming: 0,
      "out-of-stock": 0,
    } satisfies Record<Availability, number>,
  };

  const productGroups = Array.from(new Set(products.map((p) => p.group)));
  const dynFacets = dynamicFacetsForGroups(productGroups);

  for (const p of products) {
    if (p.group?.trim()) {
      groups.add(p.group);
      groupLabels[p.group] ??= groupLabelFor(p);
      counts.groups[p.group] = (counts.groups[p.group] ?? 0) + 1;
    }

    const productMaterials = uniqueValues(p.materials.map((material) => material.label));
    for (const material of productMaterials) {
      materials.add(material);
      counts.materials[material] = (counts.materials[material] ?? 0) + 1;
    }

    const productAttributes = uniqueValues(p.attributes ?? []);
    for (const attribute of productAttributes) {
      attributes.add(attribute);
      counts.attributes[attribute] = (counts.attributes[attribute] ?? 0) + 1;
    }

    const productColors = productColorValues(p);
    const currentFamilyOption = p.variantFamily?.options.find(
      (option) => option.sku === p.sku,
    );
    if (currentFamilyOption?.colorHex) {
      for (const color of productColors) {
        colorSwatches[color] ??= currentFamilyOption.colorHex;
      }
    }
    for (const color of productColors) {
      colors.add(color);
      counts.colors[color] = (counts.colors[color] ?? 0) + 1;
    }

    counts.availability[availabilityOf(p)] += 1;

    for (const f of dynFacets) {
      const v = f.getValue(p);
      if (!v) continue;
      (dynamic[f.key] ??= new Set()).add(v);
    }
  }

  const sorted = (s: Set<string>) =>
    Array.from(s).sort((a, b) => a.localeCompare(b, "sr-Latn-RS"));
  return {
    groups: Array.from(groups).sort((a, b) =>
      groupLabels[a].localeCompare(groupLabels[b], "sr-Latn-RS"),
    ),
    groupLabels,
    materials: sorted(materials),
    colors: sorted(colors),
    colorSwatches,
    attributes: sorted(attributes),
    counts,
    dynamic: Object.fromEntries(
      Object.entries(dynamic).map(([k, v]) => [k, sorted(v)]),
    ),
  };
}

function availabilityOf(p: Product): Availability {
  if (p.stock > 0) return "in-stock";
  if (p.incomingStock > 0) return "incoming";
  return "out-of-stock";
}

export function applyFilters(products: Product[], state: FilterState): Product[] {
  const groups = Array.from(new Set(products.map((p) => p.group)));
  const dynFacets = dynamicFacetsForGroups(groups);
  const dynByKey = new Map(dynFacets.map((f) => [f.key, f]));

  return products.filter((p) => {
    if (state.price) {
      const price = p.salePrice ?? p.fullPrice;
      if (price < state.price[0] || price > state.price[1]) return false;
    }
    if (state.dimensions) {
      const { w, d, h } = state.dimensions;
      if (w && (p.dimensionsCm.w < w[0] || p.dimensionsCm.w > w[1])) return false;
      if (d && (p.dimensionsCm.d < d[0] || p.dimensionsCm.d > d[1])) return false;
      if (h && (p.dimensionsCm.h < h[0] || p.dimensionsCm.h > h[1])) return false;
    }
    if (state.groups.length && !state.groups.includes(p.group)) return false;
    if (state.materials.length) {
      const labels = p.materials.map((m) => m.label);
      if (!state.materials.some((m) => labels.some((label) => facetValueEquals(m, label)))) {
        return false;
      }
    }
    if (state.colors.length) {
      const labels = productColorValues(p);
      if (!state.colors.some((c) => labels.some((label) => facetValueEquals(c, label)))) {
        return false;
      }
    }
    if (state.attributes.length) {
      const labels = p.attributes ?? [];
      if (!state.attributes.some((attribute) =>
        labels.some((label) => facetValueEquals(attribute, label)))) {
        return false;
      }
    }
    if (state.availability.length) {
      if (!state.availability.includes(availabilityOf(p))) return false;
    }
    for (const [key, values] of Object.entries(state.dynamic)) {
      if (!values.length) continue;
      const facet = dynByKey.get(key);
      if (!facet) continue;
      const v = facet.getValue(p);
      if (!v || !values.includes(v)) return false;
    }
    return true;
  });
}

/**
 * API responses are already filtered, sorted, and paginated over the complete
 * listing scope. Re-applying local filters to that page can silently discard
 * valid server matches when derived price/stock metadata differs from raw
 * catalog fields.
 */
export function resolveListingProducts(
  products: Product[],
  state: FilterState,
  sort: SortKey,
  kind: ListingKind,
  serverResolved: boolean,
) {
  return serverResolved ? products : applySort(applyFilters(products, state), sort, kind);
}

/**
 * Sort comparators.
 *
 * "default" varies per page kind — see `sortFor`. The named sorts are stable.
 */
export function applySort(products: Product[], sort: SortKey, kind: ListingKind): Product[] {
  const list = [...products];
  switch (sort) {
    case "price-asc":
      return list.sort(
        (a, b) => (a.salePrice ?? a.fullPrice) - (b.salePrice ?? b.fullPrice),
      );
    case "price-desc":
      return list.sort(
        (a, b) => (b.salePrice ?? b.fullPrice) - (a.salePrice ?? a.fullPrice),
      );
    case "discount-desc":
      return list.sort((a, b) => (b.discountPct ?? 0) - (a.discountPct ?? 0));
    case "default":
    default:
      return defaultSortFor(list, kind);
  }
}

export type ListingKind =
  | "akcija"
  | "nedeljna-akcija"
  | "heroji-meseca"
  | "niske-cene-pod-zastitom"
  | "outlet"
  | "novo"
  | "kategorija"
  | "kolekcija";

/**
 * Per-spec default sort:
 *   - akcija pages: Heroji meseca → % popusta → niža cena
 *   - novo: longest remaining "novo" status first
 *   - heroji: hero score then discount
 *   - outlet: % popusta desc, then niža cena
 *   - kategorija/kolekcija: heroji → niža cena
 */
function defaultSortFor(list: Product[], kind: ListingKind): Product[] {
  const cmpHero = (a: Product, b: Product) => Number(!!b.isHero) - Number(!!a.isHero);
  const cmpDiscount = (a: Product, b: Product) =>
    (b.discountPct ?? 0) - (a.discountPct ?? 0);
  const cmpPriceAsc = (a: Product, b: Product) =>
    (a.salePrice ?? a.fullPrice) - (b.salePrice ?? b.fullPrice);

  switch (kind) {
    case "akcija":
    case "nedeljna-akcija":
    case "niske-cene-pod-zastitom":
      return list.sort(
        (a, b) => cmpHero(a, b) || cmpDiscount(a, b) || cmpPriceAsc(a, b),
      );
    case "heroji-meseca":
      return list.sort((a, b) => cmpHero(a, b) || cmpDiscount(a, b));
    case "outlet":
      return list.sort((a, b) => cmpDiscount(a, b) || cmpPriceAsc(a, b));
    case "novo": {
      const remaining = (p: Product) =>
        p.newUntil ? new Date(p.newUntil).getTime() - Date.now() : -Infinity;
      return list.sort((a, b) => remaining(b) - remaining(a));
    }
    case "kategorija":
    case "kolekcija":
    default:
      return list.sort((a, b) => cmpHero(a, b) || cmpPriceAsc(a, b));
  }
}

/** Human label for the active filter chip strip. */
export interface ActiveChip {
  /** Stable key used to remove this chip via the reducer. */
  id: string;
  label: string;
  remove: (state: FilterState) => FilterState;
}

export function activeChips(
  state: FilterState,
  extents: FacetExtents,
  products: Product[] = [],
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  if (
    state.price &&
    (state.price[0] !== extents.price[0] || state.price[1] !== extents.price[1])
  ) {
    chips.push({
      id: "price",
      label: `Cena: ${state.price[0].toLocaleString("sr-Latn-RS")}–${state.price[1].toLocaleString(
        "sr-Latn-RS",
      )} RSD`,
      remove: (s) => ({ ...s, price: undefined }),
    });
  }
  for (const group of state.groups) {
    const matchingProduct = products.find((product) => product.group === group);
    chips.push({
      id: `group:${group}`,
      label: `Grupa: ${matchingProduct ? groupLabelFor(matchingProduct) : humanizeSlug(group)}`,
      remove: (s) => ({ ...s, groups: s.groups.filter((x) => x !== group) }),
    });
  }
  for (const m of state.materials) {
    chips.push({
      id: `material:${m}`,
      label: `Materijal: ${m}`,
      remove: (s) => ({ ...s, materials: s.materials.filter((x) => x !== m) }),
    });
  }
  for (const c of state.colors) {
    chips.push({
      id: `color:${c}`,
      label: `Boja: ${c}`,
      remove: (s) => ({ ...s, colors: s.colors.filter((x) => x !== c) }),
    });
  }
  for (const attribute of state.attributes) {
    chips.push({
      id: `attribute:${attribute}`,
      label: `Atribut: ${attribute}`,
      remove: (s) => ({
        ...s,
        attributes: s.attributes.filter((x) => x !== attribute),
      }),
    });
  }
  const dimAxes: { key: keyof DimensionRange; label: string; ext: [number, number] }[] = [
    { key: "w", label: "Š", ext: extents.width },
    { key: "d", label: "D", ext: extents.depth },
    { key: "h", label: "V", ext: extents.height },
  ];
  for (const { key, label, ext } of dimAxes) {
    const r = state.dimensions?.[key];
    if (r && (r[0] !== ext[0] || r[1] !== ext[1])) {
      chips.push({
        id: `dim:${key}`,
        label: `${label}: ${r[0]}–${r[1]} cm`,
        remove: (s) => ({
          ...s,
          dimensions: { ...(s.dimensions ?? {}), [key]: undefined },
        }),
      });
    }
  }
  for (const a of state.availability) {
    chips.push({
      id: `avail:${a}`,
      label: availabilityLabel(a),
      remove: (s) => ({
        ...s,
        availability: s.availability.filter((x) => x !== a),
      }),
    });
  }
  for (const [key, values] of Object.entries(state.dynamic)) {
    for (const v of values) {
      chips.push({
        id: `dyn:${key}:${v}`,
        label: v,
        remove: (s) => ({
          ...s,
          dynamic: {
            ...s.dynamic,
            [key]: (s.dynamic[key] ?? []).filter((x) => x !== v),
          },
        }),
      });
    }
  }
  return chips;
}

export const availabilityLabel = (a: Availability) =>
  a === "in-stock" ? "Na stanju" : a === "incoming" ? "Na putu" : "Trenutno nedostupno";

function uniqueValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = normalizeFacetValue(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function productColorValues(product: Product) {
  const currentFamilyOption = product.variantFamily?.options.find(
    (option) => option.sku === product.sku,
  );
  return uniqueValues(
    [
      currentFamilyOption?.colorHex ? currentFamilyOption.label : undefined,
      product.colorPrimary,
      product.colorSecondary,
      currentFamilyOption?.colorPrimary,
      currentFamilyOption?.colorSecondary,
    ].filter(isProductColorLabel),
  );
}

function normalizeFacetValue(value: string) {
  return value.trim().toLocaleLowerCase("sr-Latn-RS");
}

function facetValueEquals(left: string, right: string) {
  return normalizeFacetValue(left) === normalizeFacetValue(right);
}

function groupLabelFor(product: Product) {
  const normalizedGroup = normalizeFacetValue(product.group).replace(/[^a-z0-9]+/g, "-");
  const categoryLabel = [...product.categoryPath]
    .reverse()
    .find(
      (label) =>
        normalizeFacetValue(label)
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") === normalizedGroup,
    );
  return categoryLabel ?? humanizeSlug(product.group);
}

function humanizeSlug(value: string) {
  const label = value.replace(/[-_]+/g, " ").trim();
  return label ? label.charAt(0).toLocaleUpperCase("sr-Latn-RS") + label.slice(1) : value;
}
