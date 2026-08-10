export const FREE_CATEGORY_ONE_THRESHOLD_RSD = 2_000;

export type DeliveryTariffProduct = {
  qty: number;
  unitPrice: number;
  packQty?: number | null;
  packWidthCm?: number | null;
  packDepthCm?: number | null;
  packHeightCm?: number | null;
  packGrossWeightKg?: number | null;
  grossWeightKg?: number | null;
  weightKg?: number | null;
};

const RATES = {
  1: [[5, 299], [10, 399], [20, 599], [30, 899], [50, 999]],
  2: [[5, 399], [10, 499], [20, 699], [30, 999], [50, 1_099]],
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
  return dimensions.some((value) => value > 60) ? 2 : 1;
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
  const totals = {
    1: { weightKg: 0, subtotal: 0 },
    2: { weightKg: 0, subtotal: 0 },
  };
  let volumetricSurcharge = false;

  for (const product of products) {
    const dimensions = [
      product.packWidthCm ?? 0,
      product.packDepthCm ?? 0,
      product.packHeightCm ?? 0,
    ];
    const category = deliveryCategory(dimensions);
    const unitWeight = product.packGrossWeightKg ?? product.grossWeightKg ?? product.weightKg;
    if (!category || !unitWeight || unitWeight <= 0) return null;
    const packageCount = Math.max(
      1,
      Math.ceil(product.qty / Math.max(product.packQty ?? 1, 1)),
    );
    totals[category].weightKg += unitWeight * packageCount;
    totals[category].subtotal += product.unitPrice * product.qty;
    if (category === 2 && packageVolumetricDimension(dimensions) > 300) {
      volumetricSurcharge = true;
    }
  }

  const categoryOneRate = totals[1].weightKg > 0 ? deliveryRate(1, totals[1].weightKg) : 0;
  const categoryTwoRate = totals[2].weightKg > 0 ? deliveryRate(2, totals[2].weightKg) : 0;
  if (categoryOneRate == null || categoryTwoRate == null) return null;
  const categoryOnePrice =
    options.loggedIn && totals[1].subtotal > FREE_CATEGORY_ONE_THRESHOLD_RSD
      ? 0
      : categoryOneRate;
  return {
    total: categoryOnePrice + categoryTwoRate + (volumetricSurcharge ? 300 : 0),
    categoryOnePrice,
    categoryTwoPrice: categoryTwoRate,
    volumetricSurcharge: volumetricSurcharge ? 300 : 0,
  };
}
