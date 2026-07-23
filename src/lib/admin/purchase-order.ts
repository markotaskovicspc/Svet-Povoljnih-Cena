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
  packQty?: number | null;
  widthCm?: number | null;
  depthCm?: number | null;
  heightCm?: number | null;
  grossWeightKg?: number | null;
  weightKg?: number | null;
  packWidthCm?: number | null;
  packDepthCm?: number | null;
  packHeightCm?: number | null;
  packGrossWeightKg?: number | null;
}) {
  const packQty = input.packQty && input.packQty > 0 ? input.packQty : 1;
  const packVolume =
    (input.packWidthCm ?? 0) *
    (input.packDepthCm ?? 0) *
    (input.packHeightCm ?? 0);
  const itemVolume =
    (input.widthCm ?? 0) * (input.depthCm ?? 0) * (input.heightCm ?? 0);
  const volumeM3 =
    packVolume > 0
      ? packVolume / 1_000_000 / packQty
      : itemVolume > 0
        ? itemVolume / 1_000_000
        : 0;
  const weightKg =
    input.packGrossWeightKg != null && input.packGrossWeightKg > 0
      ? input.packGrossWeightKg / packQty
      : Math.max(input.grossWeightKg ?? input.weightKg ?? 0, 0);
  return {
    volumeM3: round(volumeM3, 6),
    weightKg: round(weightKg, 6),
  };
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
