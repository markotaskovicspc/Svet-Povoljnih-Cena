export type InboundInvoiceTotals = {
  netValue: number;
  vatValue: number;
  grossValue: number;
};

export type InboundInvoiceCostBreakdown = {
  invoiceValueRsd: number;
  customsValueRsd: number;
  transportValueRsd: number;
  otherRelatedCostsRsd: number;
};

export type InboundReceiptWarehouse = {
  id: string;
  name: string;
  active: boolean;
};

/**
 * Legacy posted invoices may not have their own warehouse snapshot even
 * though the linked purchase order already has an explicit receiving
 * warehouse. Reuse only that trusted order value; never guess a warehouse.
 */
export function resolveInboundReceiptWarehouse(input: {
  invoiceWarehouseId: string | null;
  invoiceWarehouse: InboundReceiptWarehouse | null;
  purchaseOrderWarehouse: InboundReceiptWarehouse | null;
}) {
  if (input.invoiceWarehouseId) {
    if (
      !input.invoiceWarehouse?.active ||
      input.invoiceWarehouse.id !== input.invoiceWarehouseId
    ) {
      throw new Error("Izaberite aktivan magacin prijema na prijemnici.");
    }
    return input.invoiceWarehouse;
  }
  if (input.purchaseOrderWarehouse?.active) {
    return input.purchaseOrderWarehouse;
  }
  throw new Error("Izaberite aktivan magacin prijema na prijemnici.");
}

export const INBOUND_INVOICE_VAT_RATE = 0.2;

export type PurchaseOrderCostLine = {
  id: string;
  sku: string;
  qty: number;
  purchasePrice: number;
  customsRatePct?: number | null;
  otherAllocatedRsd?: number | null;
};

export type CogsPreviewLine = {
  sku: string;
  qty: number;
  orderValueRsd: number;
  customsRsd: number;
  otherAllocatedRsd: number;
  linkedInvoiceCostRsd: number;
  incomingUnitCogsRsd: number;
};

export type InboundCostAllocationBasis =
  | "AUTO_UTILIZATION"
  | "VALUE"
  | "WEIGHT"
  | "VOLUME";

export type ActualInboundCostLine = {
  id: string;
  sku: string;
  qty: number;
  purchaseValueRsd: number;
  customsRatePct?: number | null;
  transportBaselineRsd?: number | null;
  totalVolumeM3?: number | null;
  totalWeightKg?: number | null;
};

export type ActualInboundCostAllocationLine = {
  id: string;
  sku: string;
  qty: number;
  invoiceValueRsd: number;
  customsRsd: number;
  transportRsd: number;
  otherRelatedCostsRsd: number;
  totalActualCostRsd: number;
  baselineCostRsd: number;
  adjustmentRsd: number;
  incomingUnitCogsRsd: number;
};

export function assertInboundInvoicePurchaseOrderLocked(input: {
  lockedAt: Date | null;
}) {
  if (!input.lockedAt) {
    throw new Error(
      "Povezana porudžbenica mora da bude proknjižena.",
    );
  }
}

function assertNonnegativeMoney(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} mora biti nenegativan broj.`);
  }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateInboundInvoiceAmounts(
  costs: InboundInvoiceCostBreakdown,
): InboundInvoiceCostBreakdown & InboundInvoiceTotals {
  assertNonnegativeMoney(costs.invoiceValueRsd, "Vrednost fakture u RSD");
  assertNonnegativeMoney(costs.customsValueRsd, "Vrednost carine u RSD");
  assertNonnegativeMoney(costs.transportValueRsd, "Vrednost transporta u RSD");
  assertNonnegativeMoney(
    costs.otherRelatedCostsRsd,
    "Vrednost ostalih vezanih troškova u RSD",
  );

  const netValue = roundMoney(
    costs.invoiceValueRsd +
      costs.customsValueRsd +
      costs.transportValueRsd +
      costs.otherRelatedCostsRsd,
  );
  const vatValue = roundMoney(netValue * INBOUND_INVOICE_VAT_RATE);
  const grossValue = roundMoney(netValue + vatValue);

  return { ...costs, netValue, vatValue, grossValue };
}

export function calculatePurchaseOrderInvoiceDefaults(input: {
  exchangeRate: number;
  freightCost: number;
  freightExchangeRate: number;
  lines: Array<{
    qty: number;
    purchasePrice: number;
    customsRatePct?: number | null;
  }>;
}): Pick<
  InboundInvoiceCostBreakdown,
  "invoiceValueRsd" | "customsValueRsd" | "transportValueRsd"
> {
  if (!Number.isFinite(input.exchangeRate) || input.exchangeRate <= 0) {
    throw new Error("Kurs porudžbenice mora biti veći od nule.");
  }
  if (
    !Number.isFinite(input.freightExchangeRate) ||
    input.freightExchangeRate <= 0
  ) {
    throw new Error("Kurs valute transporta mora biti veći od nule.");
  }
  assertNonnegativeMoney(input.freightCost, "Vrednost transporta");

  let invoiceValueRsd = 0;
  let customsValueRsd = 0;
  for (const line of input.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new Error("Količina stavke porudžbenice mora biti ceo broj veći od nule.");
    }
    assertNonnegativeMoney(line.purchasePrice, "Nabavna cena");
    const lineValueRsd = line.purchasePrice * input.exchangeRate * line.qty;
    invoiceValueRsd += lineValueRsd;
    customsValueRsd +=
      lineValueRsd * (Math.max(line.customsRatePct ?? 0, 0) / 100);
  }

  return {
    invoiceValueRsd: roundMoney(invoiceValueRsd),
    customsValueRsd: roundMoney(customsValueRsd),
    transportValueRsd: roundMoney(
      input.freightCost * input.freightExchangeRate,
    ),
  };
}

export function calculateLinkedInvoiceAdjustmentRsd(input: {
  purchaseOrderBaselineRsd: number;
  invoices: Array<{
    netValue: number;
    exchangeRate: number;
    invoiceValueRsd: number | null;
  }>;
}) {
  assertNonnegativeMoney(
    input.purchaseOrderBaselineRsd,
    "Osnovna COGS vrednost porudžbenice",
  );
  let legacyAdditionalCostsRsd = 0;
  let breakdownTotalRsd = 0;
  let hasBreakdownInvoice = false;

  for (const invoice of input.invoices) {
    assertNonnegativeMoney(invoice.netValue, "Vrednost vezane fakture");
    if (!Number.isFinite(invoice.exchangeRate) || invoice.exchangeRate <= 0) {
      throw new Error("Kurs vezane fakture mora biti veći od nule.");
    }
    const netValueRsd = invoice.netValue * invoice.exchangeRate;
    if (invoice.invoiceValueRsd == null) {
      legacyAdditionalCostsRsd += netValueRsd;
    } else {
      hasBreakdownInvoice = true;
      breakdownTotalRsd += netValueRsd;
    }
  }

  return roundMoney(
    legacyAdditionalCostsRsd +
      (hasBreakdownInvoice
        ? breakdownTotalRsd - input.purchaseOrderBaselineRsd
        : 0),
  );
}

function normalisedShares(
  values: number[],
  fallback: number[],
) {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total > 0) return values.map((value) => Math.max(value, 0) / total);
  const fallbackTotal = fallback.reduce(
    (sum, value) => sum + Math.max(value, 0),
    0,
  );
  if (fallbackTotal > 0) {
    return fallback.map((value) => Math.max(value, 0) / fallbackTotal);
  }
  return values.map(() => (values.length ? 1 / values.length : 0));
}

function allocateMoneyByShares(totalRsd: number, shares: number[]) {
  assertNonnegativeMoney(totalRsd, "Trošak za raspodelu");
  if (!shares.length) return [];
  const shareTotal = shares.reduce((sum, share) => sum + Math.max(share, 0), 0);
  const cents = Math.round(totalRsd * 100);
  let assignedCents = 0;
  return shares.map((share, index) => {
    const lineCents =
      index === shares.length - 1
        ? cents - assignedCents
        : Math.round(
            cents *
              (shareTotal > 0
                ? Math.max(share, 0) / shareTotal
                : 1 / shares.length),
          );
    assignedCents += lineCents;
    return lineCents / 100;
  });
}

function costBasisShares(
  basis: InboundCostAllocationBasis,
  values: number[],
  volumes: number[],
  weights: number[],
) {
  const valueShares = normalisedShares(values, values);
  if (basis === "VALUE") return valueShares;
  if (basis === "VOLUME") return normalisedShares(volumes, values);
  if (basis === "WEIGHT") return normalisedShares(weights, values);
  const volumeShares = normalisedShares(volumes, values);
  const weightShares = normalisedShares(weights, values);
  return values.map(
    (_value, index) =>
      Math.max(volumeShares[index] ?? 0, weightShares[index] ?? 0) ||
      (valueShares[index] ?? 0),
  );
}

/**
 * Raspodeljuje stvarne neto komponente prijemnice po stavkama:
 * - vrednost robe po vrednosti stavke,
 * - carinu po procenjenoj carini stavke (fallback: vrednost),
 * - transport po zapremini iz klijentovog pravila 69 m³ / kontejnerska
 *   količina, odnosno dimenzije transportnog pakovanja (fallback za legacy:
 *   vrednost),
 * - ostale vezane troškove po izabranoj osnovi.
 *
 * Svaka komponenta se usaglašava do poslednje pare. adjustmentRsd je jedina
 * vrednost koja se upisuje preko procene sa porudžbenice, pa se COGS ne duplira.
 */
export function allocateActualInboundCosts(input: {
  costs: InboundInvoiceCostBreakdown;
  otherCostsBasis: InboundCostAllocationBasis;
  lines: ActualInboundCostLine[];
}): ActualInboundCostAllocationLine[] {
  calculateInboundInvoiceAmounts(input.costs);
  if (!input.lines.length) return [];

  const values = input.lines.map((line) => {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new Error(`Količina za ${line.sku} mora biti ceo broj veći od nule.`);
    }
    assertNonnegativeMoney(
      line.purchaseValueRsd,
      `Vrednost porudžbenice za ${line.sku}`,
    );
    return line.purchaseValueRsd;
  });
  const estimatedCustoms = input.lines.map(
    (line) =>
      line.purchaseValueRsd *
      (Math.max(line.customsRatePct ?? 0, 0) / 100),
  );
  const volumes = input.lines.map((line) =>
    Math.max(line.totalVolumeM3 ?? 0, 0),
  );
  const weights = input.lines.map((line) =>
    Math.max(line.totalWeightKg ?? 0, 0),
  );

  const invoiceAllocations = allocateMoneyByShares(
    input.costs.invoiceValueRsd,
    normalisedShares(values, values),
  );
  const customsAllocations = allocateMoneyByShares(
    input.costs.customsValueRsd,
    normalisedShares(estimatedCustoms, values),
  );
  const transportAllocations = allocateMoneyByShares(
    input.costs.transportValueRsd,
    normalisedShares(volumes, values),
  );
  const otherAllocations = allocateMoneyByShares(
    input.costs.otherRelatedCostsRsd,
    costBasisShares(input.otherCostsBasis, values, volumes, weights),
  );

  return input.lines.map((line, index) => {
    const invoiceValueRsd = invoiceAllocations[index] ?? 0;
    const customsRsd = customsAllocations[index] ?? 0;
    const transportRsd = transportAllocations[index] ?? 0;
    const otherRelatedCostsRsd = otherAllocations[index] ?? 0;
    const totalActualCostRsd = roundMoney(
      invoiceValueRsd + customsRsd + transportRsd + otherRelatedCostsRsd,
    );
    const baselineCostRsd = roundMoney(
      line.purchaseValueRsd +
        estimatedCustoms[index] +
        Math.max(line.transportBaselineRsd ?? 0, 0),
    );
    return {
      id: line.id,
      sku: line.sku,
      qty: line.qty,
      invoiceValueRsd,
      customsRsd,
      transportRsd,
      otherRelatedCostsRsd,
      totalActualCostRsd,
      baselineCostRsd,
      adjustmentRsd: roundMoney(totalActualCostRsd - baselineCostRsd),
      incomingUnitCogsRsd: roundMoney(totalActualCostRsd / line.qty),
    };
  });
}

export function groupActualInboundCostsBySku(
  lines: ActualInboundCostAllocationLine[],
) {
  const grouped = new Map<string, ActualInboundCostAllocationLine>();
  for (const line of lines) {
    const current = grouped.get(line.sku);
    if (!current) {
      grouped.set(line.sku, { ...line });
      continue;
    }
    current.qty += line.qty;
    current.invoiceValueRsd += line.invoiceValueRsd;
    current.customsRsd += line.customsRsd;
    current.transportRsd += line.transportRsd;
    current.otherRelatedCostsRsd += line.otherRelatedCostsRsd;
    current.totalActualCostRsd += line.totalActualCostRsd;
    current.baselineCostRsd += line.baselineCostRsd;
    current.adjustmentRsd += line.adjustmentRsd;
    current.incomingUnitCogsRsd = roundMoney(
      current.totalActualCostRsd / current.qty,
    );
  }
  return Array.from(grouped.values()).map((line) => ({
    ...line,
    invoiceValueRsd: roundMoney(line.invoiceValueRsd),
    customsRsd: roundMoney(line.customsRsd),
    transportRsd: roundMoney(line.transportRsd),
    otherRelatedCostsRsd: roundMoney(line.otherRelatedCostsRsd),
    totalActualCostRsd: roundMoney(line.totalActualCostRsd),
    baselineCostRsd: roundMoney(line.baselineCostRsd),
    adjustmentRsd: roundMoney(line.adjustmentRsd),
  }));
}

/**
 * Validates the accounting identity used when an inbound invoice is locked.
 * Values are intentionally kept as numbers here; the database persists them
 * as fixed-scale decimals.
 */
export function validateInboundInvoiceTotals(
  totals: InboundInvoiceTotals,
): InboundInvoiceTotals {
  assertNonnegativeMoney(totals.netValue, "Vrednost bez PDV-a");
  assertNonnegativeMoney(totals.vatValue, "PDV");
  assertNonnegativeMoney(totals.grossValue, "Bruto vrednost");
  if (Math.abs(totals.netValue + totals.vatValue - totals.grossValue) > 0.01) {
    throw new Error("Vrednost bez PDV-a + PDV mora biti jednaka bruto vrednosti.");
  }
  return totals;
}

/**
 * Allocates all linked invoice costs by the purchase-order value of each SKU.
 * The result always reconciles to the cent, including the final rounding cent.
 */
export function allocateInvoiceCostsByOrderValue(
  totalCostRsd: number,
  lines: PurchaseOrderCostLine[],
) {
  if (!Number.isFinite(totalCostRsd)) {
    throw new Error("Ukupna korekcija vezanih faktura mora biti broj.");
  }
  if (!lines.length) return new Map<string, number>();

  const values = lines.map((line) => {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new Error(`Količina za ${line.sku} mora biti ceo broj veći od nule.`);
    }
    assertNonnegativeMoney(line.purchasePrice, `Nabavna cena za ${line.sku}`);
    return line.purchasePrice * line.qty;
  });
  const totalOrderValue = values.reduce((sum, value) => sum + value, 0);
  if (totalOrderValue <= 0 && totalCostRsd > 0) {
    throw new Error("Vrednost porudžbenice mora biti veća od nule za COGS raspodelu.");
  }

  const totalCents = Math.round(totalCostRsd * 100);
  let assignedCents = 0;
  const allocations = new Map<string, number>();
  lines.forEach((line, index) => {
    const cents =
      index === lines.length - 1
        ? totalCents - assignedCents
        : Math.round(
            totalCents *
              (totalOrderValue > 0 ? values[index] / totalOrderValue : 0),
          );
    assignedCents += cents;
    allocations.set(line.id, cents / 100);
  });
  return allocations;
}

/**
 * Calculates the incoming unit COGS by SKU. Customs and an already allocated
 * order-level cost (for example freight) can be included so this preview uses
 * the same landed-cost components as goods receipt.
 */
export function calculateCogsBySku(input: {
  orderExchangeRate: number;
  linkedInvoiceCostRsd: number;
  lines: PurchaseOrderCostLine[];
}): CogsPreviewLine[] {
  if (!Number.isFinite(input.orderExchangeRate) || input.orderExchangeRate <= 0) {
    throw new Error("Kurs porudžbenice mora biti veći od nule.");
  }
  const allocations = allocateInvoiceCostsByOrderValue(
    input.linkedInvoiceCostRsd,
    input.lines,
  );
  const grouped = new Map<
    string,
    {
      qty: number;
      orderValueRsd: number;
      customsRsd: number;
      otherAllocatedRsd: number;
      linkedInvoiceCostRsd: number;
    }
  >();

  for (const line of input.lines) {
    const current = grouped.get(line.sku) ?? {
      qty: 0,
      orderValueRsd: 0,
      customsRsd: 0,
      otherAllocatedRsd: 0,
      linkedInvoiceCostRsd: 0,
    };
    const orderValueRsd =
      line.purchasePrice * input.orderExchangeRate * line.qty;
    current.qty += line.qty;
    current.orderValueRsd += orderValueRsd;
    current.customsRsd +=
      orderValueRsd * (Math.max(line.customsRatePct ?? 0, 0) / 100);
    current.otherAllocatedRsd += Math.max(line.otherAllocatedRsd ?? 0, 0);
    current.linkedInvoiceCostRsd += allocations.get(line.id) ?? 0;
    grouped.set(line.sku, current);
  }

  return Array.from(grouped, ([sku, values]) => ({
    sku,
    qty: values.qty,
    orderValueRsd: Number(values.orderValueRsd.toFixed(2)),
    customsRsd: Number(values.customsRsd.toFixed(2)),
    otherAllocatedRsd: Number(values.otherAllocatedRsd.toFixed(2)),
    linkedInvoiceCostRsd: Number(values.linkedInvoiceCostRsd.toFixed(2)),
    incomingUnitCogsRsd: Number(
      (
        (values.orderValueRsd +
          values.customsRsd +
          values.otherAllocatedRsd +
          values.linkedInvoiceCostRsd) /
        values.qty
      ).toFixed(2),
    ),
  }));
}

export function weightedAverageCogs(input: {
  existingQty: number;
  existingUnitCogs: number;
  incomingQty: number;
  incomingUnitCogs: number;
}) {
  for (const [label, value] of Object.entries(input)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} mora biti nenegativan broj.`);
    }
  }
  const totalQty = input.existingQty + input.incomingQty;
  if (totalQty === 0) return 0;
  return Number(
    (
      (input.existingQty * input.existingUnitCogs +
        input.incomingQty * input.incomingUnitCogs) /
      totalQty
    ).toFixed(2),
  );
}
