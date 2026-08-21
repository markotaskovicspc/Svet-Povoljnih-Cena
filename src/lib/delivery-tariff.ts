export const FREE_CATEGORY_ONE_THRESHOLD_RSD = 2_000;

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
  | "WEIGHT_ABOVE_50_KG";

export type PublishedDeliveryTariffQuote = {
  total: number | null;
  categoryOnePrice: number | null;
  categoryTwoPrice: number | null;
  categories: PublishedDeliveryCategoryBreakdown | null;
  issue: DeliveryTariffIssue | null;
};

const RATES = {
  1: [[5, 299], [10, 399], [20, 599], [30, 899], [50, 999]],
  2: [[5, 699], [10, 799], [20, 999], [30, 1_299], [50, 1_399]],
} as const;

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
  // The client explicitly deferred the exact 300 cm boundary. Do not invent
  // which side owns it: returning null keeps the configured admin fallback.
  if (volumetricDimension === 300) return null;
  return volumetricDimension < 300 ? 1 : 2;
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

export function deliveryRate(category: 1 | 2, weightKg: number) {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  return RATES[category].find(([limit]) => weightKg <= limit)?.[1] ?? null;
}

/** Published tariff. Above 50 kg returns null so an explicit admin rule wins. */
export function calculatePublishedDeliveryTariff(
  products: DeliveryTariffProduct[],
  options: { loggedIn: boolean },
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
 * Detailed tariff result used by checkout. Unlike the legacy nullable helper,
 * it preserves category weights when the published table ends at 50 kg so the
 * UI can explain why it must not invent a delivery price.
 */
export function calculatePublishedDeliveryTariffQuote(
  products: DeliveryTariffProduct[],
  options: { loggedIn: boolean },
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
        ? null
        : packageWeight / Math.max(product.packQty ?? 1, 1));
    if (unitWeight == null) {
      return unavailableTariff("MISSING_WEIGHT");
    }
    totals[category].weightKg += unitWeight * product.qty;
    totals[category].subtotal += product.unitPrice * product.qty;
  }

  const categoryOneRate = totals[1].weightKg > 0 ? deliveryRate(1, totals[1].weightKg) : 0;
  const categoryTwoRate = totals[2].weightKg > 0 ? deliveryRate(2, totals[2].weightKg) : 0;
  const categoryOnePrice =
    options.loggedIn && totals[1].subtotal > FREE_CATEGORY_ONE_THRESHOLD_RSD
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
      issue: "WEIGHT_ABOVE_50_KG",
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

function unavailableTariff(issue: Exclude<DeliveryTariffIssue, "WEIGHT_ABOVE_50_KG">) {
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
