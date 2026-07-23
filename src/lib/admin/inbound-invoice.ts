export type InboundInvoiceTotals = {
  netValue: number;
  vatValue: number;
  grossValue: number;
};

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

function assertNonnegativeMoney(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} mora biti nenegativan broj.`);
  }
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
  assertNonnegativeMoney(totalCostRsd, "Ukupna vrednost vezanih faktura");
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
