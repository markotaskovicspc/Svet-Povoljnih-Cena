export const FREE_CATEGORY_ONE_THRESHOLD_RSD = 4_000;
export const PREVIOUS_FREE_CATEGORY_ONE_THRESHOLD_RSD = 1_999;
/** 1 September 2026 at 00:01 in Europe/Belgrade (CEST, UTC+02:00). */
export const FREE_CATEGORY_ONE_THRESHOLD_CHANGE_AT_MS = Date.parse(
  "2026-09-01T00:01:00+02:00",
);
/** Customer-favouring checkout estimate when an article has no usable weight data. */
export const MISSING_UNIT_WEIGHT_FALLBACK_KG = 1;

export type DeliveryTariffProduct = {
  qty: number;
  unitPrice: number;
  packQty?: number | null;
  unitPackWidthCm?: number | null;
  unitPackDepthCm?: number | null;
  unitPackHeightCm?: number | null;
  packWidthCm?: number | null;
  packDepthCm?: number | null;
  packHeightCm?: number | null;
  packGrossWeightKg?: number | null;
  grossWeightKg?: number | null;
  weightKg?: number | null;
};

export type DeliveryCategory = 1 | 2;

export type DeliveryTariffRates = Record<
  DeliveryCategory,
  readonly (readonly [weightLimitKg: number, priceRsd: number])[]
>;

export type PublishedDeliveryCategoryTotal = {
  weightKg: number;
  subtotal: number;
  price: number | null;
};

export type PublishedDeliveryCategoryBreakdown = Record<
  DeliveryCategory,
  PublishedDeliveryCategoryTotal
>;

export type DeliveryTariffIssue =
  | "MISSING_PACKAGE_DIMENSIONS"
  | "MISSING_WEIGHT"
  | "WEIGHT_OUTSIDE_TARIFF";

export type PublishedDeliveryTariffQuote = {
  total: number | null;
  categoryOnePrice: number | null;
  categoryTwoPrice: number | null;
  categories: PublishedDeliveryCategoryBreakdown | null;
  issue: DeliveryTariffIssue | null;
};

export const DEFAULT_DELIVERY_TARIFF_RATES = {
  1: [
    [5, 299],
    [10, 399],
    [20, 599],
    [30, 899],
    [Number.POSITIVE_INFINITY, 999],
  ],
  2: [
    [5, 699],
    [10, 799],
    [20, 999],
    [30, 1_299],
    [50, 1_499],
    [70, 1_699],
    [100, 1_899],
    [Number.POSITIVE_INFINITY, 2_099],
  ],
} as const satisfies DeliveryTariffRates;

export function packageVolumetricDimension(dimensions: readonly number[]) {
  const [longest, middle, shortest] = [...dimensions].sort((a, b) => b - a);
  return longest + 2 * middle + 2 * shortest;
}

export function deliveryCategory(dimensions: readonly number[]) {
  if (
    dimensions.length !== 3 ||
    !dimensions.every((value) => Number.isFinite(value) && value > 0)
  ) {
    return null;
  }
  const volumetricDimension = packageVolumetricDimension(dimensions);
  return volumetricDimension <= 300 ? 1 : 2;
}

/** Public category is based on the package of one sellable article, not a transport carton. */
export function productDeliveryCategory(
  product: Pick<
    DeliveryTariffProduct,
    "unitPackWidthCm" | "unitPackDepthCm" | "unitPackHeightCm"
  >,
) {
  return deliveryCategory([
    product.unitPackWidthCm ?? 0,
    product.unitPackDepthCm ?? 0,
    product.unitPackHeightCm ?? 0,
  ]);
}

export function deliveryRate(
  category: DeliveryCategory,
  weightKg: number,
  rates: DeliveryTariffRates = DEFAULT_DELIVERY_TARIFF_RATES,
) {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  return rates[category].find(([limit]) => weightKg <= limit)?.[1] ?? null;
}

export function freeCategoryOneThresholdRsd(at: Date = new Date()) {
  return at.getTime() >= FREE_CATEGORY_ONE_THRESHOLD_CHANGE_AT_MS
    ? FREE_CATEGORY_ONE_THRESHOLD_RSD
    : PREVIOUS_FREE_CATEGORY_ONE_THRESHOLD_RSD;
}

/** Published tariff for the complete supported weight range. */
export function calculatePublishedDeliveryTariff(
  products: DeliveryTariffProduct[],
  options: { loggedIn: boolean; rates?: DeliveryTariffRates; at?: Date },
) {
  const quote = calculatePublishedDeliveryTariffQuote(products, options);
  if (quote.total == null || !quote.categories) return null;
  return {
    total: quote.total,
    categoryOnePrice: quote.categoryOnePrice!,
    categoryTwoPrice: quote.categoryTwoPrice!,
    categories: quote.categories,
  };
}

/**
 * Detailed tariff result used by checkout. It preserves category weights if a
 * caller supplies an incomplete custom tariff, so the UI can explain why a
 * delivery price could not be calculated.
 */
export function calculatePublishedDeliveryTariffQuote(
  products: DeliveryTariffProduct[],
  options: { loggedIn: boolean; rates?: DeliveryTariffRates; at?: Date },
): PublishedDeliveryTariffQuote {
  const totals = {
    1: { weightKg: 0, subtotal: 0 },
    2: { weightKg: 0, subtotal: 0 },
  };
  for (const product of products) {
    const category = productDeliveryCategory(product);
    if (!category) {
      return unavailableTariff("MISSING_PACKAGE_DIMENSIONS");
    }
    const packageWeight = positiveWeight(product.packGrossWeightKg);
    const unitWeight =
      positiveWeight(product.grossWeightKg) ??
      positiveWeight(product.weightKg) ??
      (packageWeight == null
        ? MISSING_UNIT_WEIGHT_FALLBACK_KG
        : packageWeight / Math.max(product.packQty ?? 1, 1));
    totals[category].weightKg += unitWeight * product.qty;
    totals[category].subtotal += product.unitPrice * product.qty;
  }

  const categoryOneRate =
    totals[1].weightKg > 0
      ? deliveryRate(1, totals[1].weightKg, options.rates)
      : 0;
  const categoryTwoRate =
    totals[2].weightKg > 0
      ? deliveryRate(2, totals[2].weightKg, options.rates)
      : 0;
  const categoryOnePrice =
    totals[1].subtotal >= freeCategoryOneThresholdRsd(options.at)
      ? 0
      : categoryOneRate;
  if (categoryOneRate == null || categoryTwoRate == null) {
    return {
      total: null,
      categoryOnePrice,
      categoryTwoPrice: categoryTwoRate,
      categories: {
        1: { ...totals[1], price: categoryOnePrice },
        2: { ...totals[2], price: categoryTwoRate },
      },
      issue: "WEIGHT_OUTSIDE_TARIFF",
    };
  }
  return {
    total: categoryOnePrice! + categoryTwoRate,
    categoryOnePrice,
    categoryTwoPrice: categoryTwoRate,
    categories: {
      1: { ...totals[1], price: categoryOnePrice },
      2: { ...totals[2], price: categoryTwoRate },
    } satisfies PublishedDeliveryCategoryBreakdown,
    issue: null,
  };
}

function unavailableTariff(
  issue: Exclude<DeliveryTariffIssue, "WEIGHT_OUTSIDE_TARIFF">,
) {
  return {
    total: null,
    categoryOnePrice: null,
    categoryTwoPrice: null,
    categories: null,
    issue,
  } satisfies PublishedDeliveryTariffQuote;
}

function positiveWeight(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}
