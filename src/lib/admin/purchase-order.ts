import type { PurchaseOrderStatus } from "@prisma/client";

export type PurchaseOrderLineCalculationInput = {
  id: string;
  qty: number;
  purchasePrice: number;
  calcRetailPrice: number | null;
  customsRatePct: number | null;
  totalVolumeM3: number;
  totalWeightKg: number;
};

export type PurchaseOrderLineCalculation = {
  id: string;
  freightAllocatedRsd: number;
  freightPerUnitRsd: number;
  purchasePriceRsd: number;
  customsPerUnitRsd: number;
  bmPct: number | null;
};

export const STANDARD_CONTAINER_VOLUME_M3 = 69;

export const PRODUCT_LOGISTICS_SOURCE_ERROR =
  "Unesite količinu za ceo kontejner ili kom/pak i sve tri dimenzije transportnog pakovanja (širinu, dubinu i visinu).";

type ProductLogisticsSourceInput = {
  containerQty?: number | null;
  containerGrossWeightKg?: number | null;
  unitPackWidthCm?: number | null;
  unitPackDepthCm?: number | null;
  unitPackHeightCm?: number | null;
  packQty?: number | null;
  packWidthCm?: number | null;
  packDepthCm?: number | null;
  packHeightCm?: number | null;
};

function isPositiveNumber(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0;
}

/**
 * An editable order may contain a zero/null customs snapshot when its article
 * did not have customs master data yet. Fill only that missing snapshot from
 * the current article; an explicit non-zero order correction keeps priority.
 */
export function resolveOpenPurchaseOrderCustomsRate(input: {
  itemCustomsRate: number | null;
  productCustomsRate: number | null;
}) {
  if (isPositiveNumber(input.itemCustomsRate)) {
    return input.itemCustomsRate;
  }
  if (isPositiveNumber(input.productCustomsRate)) {
    return input.productCustomsRate;
  }
  return input.itemCustomsRate ?? input.productCustomsRate;
}

/**
 * Client rule: container quantity is an alternative volume source and wins
 * over transport-package dimensions. Container gross weight is optional; when
 * absent, unit/product gross weight remains the weight source.
 */
export function productLogisticsSource(
  input: ProductLogisticsSourceInput,
): "container" | "package" | null {
  if (isPositiveNumber(input.containerQty)) {
    return "container";
  }

  if (
    isPositiveNumber(input.packQty) &&
    [input.packWidthCm, input.packDepthCm, input.packHeightCm].every(
      isPositiveNumber,
    )
  ) {
    return "package";
  }

  return null;
}

function finiteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} mora biti nenegativan broj.`);
  }
  return value;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function isPackQuantityValid(qty: number, packQty: number | null | undefined) {
  return !packQty || packQty <= 0 || qty % packQty === 0;
}

export function calculateDeliveryDate(input: {
  orderDate: Date | null;
  loadingDate: Date | null;
  deliveryDays: number | null;
  transitDays: number | null;
}) {
  const base =
    input.loadingDate && input.transitDays != null
      ? { date: input.loadingDate, days: input.transitDays }
      : input.orderDate && input.deliveryDays != null
        ? { date: input.orderDate, days: input.deliveryDays }
        : null;
  if (!base) return null;
  const result = new Date(base.date);
  result.setUTCDate(result.getUTCDate() + Math.max(0, base.days));
  return result;
}

export function calculateUnitLogistics(input: {
  containerQty?: number | null;
  containerGrossWeightKg?: number | null;
  unitPackWidthCm?: number | null;
  unitPackDepthCm?: number | null;
  unitPackHeightCm?: number | null;
  packQty?: number | null;
  grossWeightKg?: number | null;
  weightKg?: number | null;
  packWidthCm?: number | null;
  packDepthCm?: number | null;
  packHeightCm?: number | null;
  packGrossWeightKg?: number | null;
}) {
  const containerQty =
    input.containerQty && input.containerQty > 0 ? input.containerQty : null;
  const packQty = input.packQty && input.packQty > 0 ? input.packQty : null;
  const packDimensions = [
    input.packWidthCm ?? 0,
    input.packDepthCm ?? 0,
    input.packHeightCm ?? 0,
  ];
  const source = productLogisticsSource(input);
  const volumeM3 =
    source === "container" && containerQty
      ? STANDARD_CONTAINER_VOLUME_M3 / containerQty
      : source === "package" && packQty
        ? (packDimensions[0] * packDimensions[1] * packDimensions[2]) /
          1_000_000 /
          packQty
        : 0;
  const weightPackQty = packQty ?? 1;
  const weightKg =
    source === "container" &&
    containerQty &&
    input.containerGrossWeightKg != null &&
    input.containerGrossWeightKg > 0
      ? input.containerGrossWeightKg / containerQty
      : source === "package" &&
          input.packGrossWeightKg != null &&
          input.packGrossWeightKg > 0
      ? input.packGrossWeightKg / weightPackQty
      : Math.max(input.grossWeightKg ?? input.weightKg ?? 0, 0);
  return {
    volumeM3: round(volumeM3, 6),
    weightKg: round(weightKg, 6),
  };
}

export function hasProductVolumeSource(input: ProductLogisticsSourceInput) {
  return productLogisticsSource(input) !== null;
}

export function canReceivePurchaseOrder(input: {
  status: PurchaseOrderStatus;
  lockedAt: Date | null;
}) {
  return (
    input.lockedAt !== null &&
    (input.status === "DRAFT" ||
      input.status === "SENT" ||
      input.status === "CONFIRMED")
  );
}

/**
 * Allocates order freight by the larger normalised volume/weight utilisation,
 * then calculates customs and BM% from the formula in ERP module 4.
 */
export function calculatePurchaseOrderFinancials(input: {
  lines: PurchaseOrderLineCalculationInput[];
  exchangeRate: number;
  freightCost: number;
  freightExchangeRate: number;
}) {
  const exchangeRate = finiteNonNegative(input.exchangeRate, "Kurs nabavne valute");
  const freightCost = finiteNonNegative(input.freightCost, "Cena prevoza");
  const freightExchangeRate = finiteNonNegative(
    input.freightExchangeRate,
    "Kurs valute prevoza",
  );
  const totalFreightRsd = round(freightCost * freightExchangeRate, 2);
  const totalVolume = input.lines.reduce(
    (sum, line) => sum + Math.max(line.totalVolumeM3, 0),
    0,
  );
  const totalWeight = input.lines.reduce(
    (sum, line) => sum + Math.max(line.totalWeightKg, 0),
    0,
  );
  const totalValue = input.lines.reduce(
    (sum, line) => sum + Math.max(line.purchasePrice * line.qty, 0),
    0,
  );
  const weights = input.lines.map((line) => {
    const volumeShare =
      totalVolume > 0 ? Math.max(line.totalVolumeM3, 0) / totalVolume : 0;
    const weightShare =
      totalWeight > 0 ? Math.max(line.totalWeightKg, 0) / totalWeight : 0;
    const valueShare =
      totalValue > 0
        ? Math.max(line.purchasePrice * line.qty, 0) / totalValue
        : 0;
    return Math.max(volumeShare, weightShare) || valueShare;
  });
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const freightCents = Math.round(totalFreightRsd * 100);
  let allocatedCents = 0;
  let weightedBm = 0;
  let weightedBmBase = 0;

  const lines: PurchaseOrderLineCalculation[] = input.lines.map((line, index) => {
    const isLast = index === input.lines.length - 1;
    const lineCents = isLast
      ? freightCents - allocatedCents
      : Math.round(
          freightCents *
            (weightTotal > 0 ? weights[index] / weightTotal : 1 / input.lines.length),
        );
    allocatedCents += lineCents;
    const freightAllocatedRsd = lineCents / 100;
    const freightPerUnitRsd = line.qty > 0 ? freightAllocatedRsd / line.qty : 0;
    const purchasePriceRsd = line.purchasePrice * exchangeRate;
    const customsPerUnitRsd =
      (purchasePriceRsd + freightPerUnitRsd) *
      (Math.max(line.customsRatePct ?? 0, 0) / 100);
    const netRetail =
      line.calcRetailPrice != null ? line.calcRetailPrice / 1.2 : 0;
    const bm =
      netRetail - purchasePriceRsd - freightPerUnitRsd - customsPerUnitRsd;
    const bmPct = netRetail > 0 ? round((bm / netRetail) * 100, 2) : null;
    if (bmPct != null) {
      weightedBm += bmPct * netRetail * line.qty;
      weightedBmBase += netRetail * line.qty;
    }
    return {
      id: line.id,
      freightAllocatedRsd,
      freightPerUnitRsd: round(freightPerUnitRsd, 4),
      purchasePriceRsd: round(purchasePriceRsd, 4),
      customsPerUnitRsd: round(customsPerUnitRsd, 4),
      bmPct,
    };
  });

  return {
    lines,
    totalFreightRsd,
    totalBmPct:
      weightedBmBase > 0 ? round(weightedBm / weightedBmBase, 2) : null,
  };
}

export function purchaseOrderCapacityWarnings(input: {
  totalVolumeM3: number;
  totalWeightKg: number;
  payloadM3: number | null;
  payloadKg: number | null;
}) {
  const warnings: string[] = [];
  if (input.payloadM3 != null && input.totalVolumeM3 > input.payloadM3) {
    warnings.push(
      `Ukupna zapremina ${round(input.totalVolumeM3, 3)} m³ prelazi kapacitet ${round(input.payloadM3, 3)} m³.`,
    );
  }
  if (input.payloadKg != null && input.totalWeightKg > input.payloadKg) {
    warnings.push(
      `Ukupna težina ${round(input.totalWeightKg, 3)} kg prelazi nosivost ${round(input.payloadKg, 3)} kg.`,
    );
  }
  return warnings;
}

export const PURCHASE_ORDER_EMAIL_BODY = `Dear,
Please kindly confirm receipt of our new order.
If any parameters or specifications of the order are not suitable or require adjustment, please inform us by email and specify which parts need to be revised.

Best regards`;

export function purchaseOrderEmailSubject(number: string) {
  return `Order NO ${number}`;
}
