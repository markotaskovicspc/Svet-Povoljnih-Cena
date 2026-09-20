import { describe, expect, it } from "vitest";
import { resolvePurchaseOrderLineLogistics } from "@/lib/admin/purchase-order";
import {
  allocateActualInboundCosts,
  allocateInvoiceCostsByOrderValue,
  assertInboundCostVolumeReady,
  assertInboundInvoicePurchaseOrderLocked,
  calculateInboundInvoiceAmounts,
  calculateInboundInvoiceValueRsd,
  calculateLinkedInvoiceAdjustmentRsd,
  calculatePurchaseOrderInvoiceDefaults,
  calculateCogsBySku,
  groupActualInboundCostsBySku,
  resolveInboundReceiptWarehouse,
  validateInboundInvoiceTotals,
  weightedAverageCogs,
  reconcileInboundGoods,
  resolveInboundInvoiceFx,
} from "@/lib/admin/inbound-invoice";

describe("ERP module 5 inbound invoices and COGS", () => {
  it("derives the rate from both invoice amounts without losing the saved RSD cent", () => {
    expect(resolveInboundInvoiceFx({ currency: "USD", invoiceValue: 16_992, invoiceValueRsd: 1_717_177, exchangeRate: 1, exchangeRateSource: "RSD_VALUE" }))
      .toEqual({ exchangeRate: 101.057968, invoiceValueRsd: 1_717_177 });
    expect(resolveInboundInvoiceFx({ currency: "USD", invoiceValue: 16_992, invoiceValueRsd: 1_717_177, exchangeRate: 100, exchangeRateSource: "RATE" }))
      .toEqual({ exchangeRate: 100, invoiceValueRsd: 1_699_200 });
    expect(() => resolveInboundInvoiceFx({ currency: "USD", invoiceValue: 0, invoiceValueRsd: 100, exchangeRate: 1, exchangeRateSource: "RSD_VALUE" })).toThrow("pozitivnu vrednost");
  });

  it("shows invoice FX instead of silently inflating Marko's goods value when totals disagree", () => {
    // UF-2026-0025: first line is 5.66 USD × 120. The other lines are
    // represented by their aggregate here, not fabricated individual SKUs.
    const lines = [{ qty: 120, purchasePrice: 5.66 }, { qty: 1, purchasePrice: 15_237.6 }];
    const reconciliation = reconcileInboundGoods({
      invoiceValue: 16_992, invoiceValueRsd: 1_717_177,
      invoiceCurrency: "USD", orderCurrency: "USD", lines,
    });
    expect(reconciliation.orderValue).toBe(15_916.8);
    expect(reconciliation.exchangeRate).toBeCloseTo(101.0579684557, 8);
    expect(reconciliation.lineValuesRsd?.[0]).toBe(68_638.57);
    expect(reconciliation.error).toContain("1.075,20 USD");
    expect(reconciliation.differenceRsd).toBeGreaterThan(100_000);
    const input = {
      costs: { invoiceValueRsd: 1_717_177, customsValueRsd: 0, transportValueRsd: 0, otherRelatedCostsRsd: 0 },
      otherCostsBasis: "VOLUME" as const,
      lines: lines.map((line, index) => ({ id: String(index), sku: String(index), qty: line.qty, purchaseValueRsd: line.qty * line.purchasePrice })),
    };
    // Reproduce the exact old screenshot, then verify the corrected preview.
    expect(allocateActualInboundCosts(input)[0].invoiceValueRsd).toBe(73_275.19);
    expect(allocateActualInboundCosts({ ...input, goodsValuesRsd: reconciliation.lineValuesRsd! })[0].invoiceValueRsd).toBe(68_638.57);
  });

  it("reconciles matching foreign totals to the last cent without changing cost shares", () => {
    const result = reconcileInboundGoods({
      invoiceValue: 3, invoiceValueRsd: 100,
      invoiceCurrency: "EUR", orderCurrency: "EUR",
      lines: [1, 1, 1].map((purchasePrice) => ({ qty: 1, purchasePrice })),
    });
    expect(result.error).toBeNull();
    expect(result.lineValuesRsd).toEqual([33.33, 33.33, 33.34]);
    expect(result.differenceRsd).toBe(0);
  });

  it("does not infer FX from mismatched currencies or an empty invoice value", () => {
    const input = { invoiceValue: 100, invoiceValueRsd: 100, invoiceCurrency: "EUR" as const, orderCurrency: "USD" as const, lines: [{ qty: 1, purchasePrice: 1 }] };
    expect(reconcileInboundGoods(input)).toMatchObject({ lineValuesRsd: null, error: expect.stringContaining("Valuta fakture") });
    expect(reconcileInboundGoods({ ...input, invoiceCurrency: "USD", invoiceValue: 0 })).toMatchObject({ lineValuesRsd: null, error: expect.stringContaining("nulte vrednosti") });
  });

  it("handles domestic and free goods without inventing an exchange-rate difference", () => {
    for (const amount of [0, 100]) {
      expect(reconcileInboundGoods({ invoiceValue: amount, invoiceValueRsd: amount, invoiceCurrency: "RSD", orderCurrency: "RSD", lines: [{ qty: 2, purchasePrice: amount / 2 }] })).toMatchObject({ error: null, exchangeRate: 1, lineValuesRsd: [amount], differenceRsd: 0 });
    }
  });

  it("accepts small transport packages and allocates costs in their actual volume ratio", () => {
    const lines = [2, 4].map((width, index) => ({
      id: String(index), sku: String(index), qty: 24, purchaseValueRsd: 1000,
      totalVolumeM3: resolvePurchaseOrderLineLogistics({
        locked: true, qty: 24, snapshottedTotalVolumeM3: 0,
        product: { packQty: 2, packWidthCm: width, packDepthCm: 2, packHeightCm: 2 },
      }).totalVolumeM3,
    }));
    expect(() => assertInboundCostVolumeReady(lines)).not.toThrow();
    const allocations = allocateActualInboundCosts({
      costs: { invoiceValueRsd: 2000, customsValueRsd: 0, transportValueRsd: 300, otherRelatedCostsRsd: 30 },
      otherCostsBasis: "VOLUME", lines,
    });
    expect(allocations.map(line => line.transportRsd)).toEqual([100, 200]);
    expect(allocations.map(line => line.otherRelatedCostsRsd)).toEqual([10, 20]);
  });

  it("reuses the purchase-order warehouse for a legacy posted invoice", () => {
    expect(
      resolveInboundReceiptWarehouse({
        invoiceWarehouseId: null,
        invoiceWarehouse: null,
        purchaseOrderWarehouse: {
          id: "warehouse-dc",
          name: "DC",
          active: true,
        },
      }),
    ).toEqual({ id: "warehouse-dc", name: "DC", active: true });
  });

  it("does not replace an explicit inactive invoice warehouse", () => {
    expect(() =>
      resolveInboundReceiptWarehouse({
        invoiceWarehouseId: "warehouse-old",
        invoiceWarehouse: {
          id: "warehouse-old",
          name: "Stari magacin",
          active: false,
        },
        purchaseOrderWarehouse: {
          id: "warehouse-dc",
          name: "DC",
          active: true,
        },
      }),
    ).toThrow(/aktivan magacin prijema/);
  });

  it("requires an explicit trusted warehouse when no fallback exists", () => {
    expect(() =>
      resolveInboundReceiptWarehouse({
        invoiceWarehouseId: null,
        invoiceWarehouse: null,
        purchaseOrderWarehouse: null,
      }),
    ).toThrow(/aktivan magacin prijema/);
  });

  it("requires the linked purchase order to be posted before invoice cost booking", () => {
    expect(() =>
      assertInboundInvoicePurchaseOrderLocked({ lockedAt: null }),
    ).toThrow(/mora da bude proknjižena/);
    expect(() =>
      assertInboundInvoicePurchaseOrderLocked({ lockedAt: new Date() }),
    ).not.toThrow();
  });

  it("prefills RSD invoice, customs and transport values from the purchase order", () => {
    expect(
      calculatePurchaseOrderInvoiceDefaults({
        exchangeRate: 120,
        freightCost: 100,
        freightExchangeRate: 120,
        lines: [
          { qty: 10, purchasePrice: 10, customsRatePct: 10 },
          { qty: 5, purchasePrice: 20, customsRatePct: 5 },
        ],
      }),
    ).toEqual({
      invoiceValueRsd: 24_000,
      customsValueRsd: 1_800,
      transportValueRsd: 12_000,
    });
  });

  it("calculates net, 20% VAT and gross from the editable cost components", () => {
    expect(
      calculateInboundInvoiceAmounts({
        invoiceValueRsd: 24_000,
        customsValueRsd: 1_800,
        transportValueRsd: 12_000,
        otherRelatedCostsRsd: 200,
      }),
    ).toEqual({
      invoiceValueRsd: 24_000,
      customsValueRsd: 1_800,
      transportValueRsd: 12_000,
      otherRelatedCostsRsd: 200,
      netValue: 38_000,
      vatValue: 7_600,
      grossValue: 45_600,
    });
  });

  it("converts the final invoice currency with the entered middle exchange rate", () => {
    expect(
      calculateInboundInvoiceValueRsd({
        invoiceValue: 12_540,
        currency: "EUR",
        exchangeRate: 102.16,
      }),
    ).toBe(1_281_086.4);
    expect(
      calculateInboundInvoiceValueRsd({
        invoiceValue: 12_540,
        currency: "RSD",
        exchangeRate: 999,
      }),
    ).toBe(12_540);
  });

  it("turns a complete COGS invoice into only the adjustment over the PO baseline", () => {
    expect(
      calculateLinkedInvoiceAdjustmentRsd({
        purchaseOrderBaselineRsd: 8_500,
        invoices: [
          {
            netValue: 9_000,
            exchangeRate: 120,
            invoiceValueRsd: 8_500,
          },
        ],
      }),
    ).toBe(500);
  });

  it("blocks posting when any received line has no volume", () => {
    expect(() =>
      assertInboundCostVolumeReady([
        { sku: "A", qty: 10, totalVolumeM3: 2 },
        { sku: "B", qty: 5, totalVolumeM3: 0 },
      ]),
    ).toThrow(/zapremina za: B/);
    expect(() =>
      assertInboundCostVolumeReady([
        { sku: "A", qty: 10, totalVolumeM3: 2 },
        { sku: "B", qty: 0, totalVolumeM3: 0 },
      ]),
    ).not.toThrow();
  });

  it("requires net plus VAT to reconcile with gross", () => {
    expect(
      validateInboundInvoiceTotals({
        netValue: 1_000,
        vatValue: 200,
        grossValue: 1_200,
      }),
    ).toEqual({
      netValue: 1_000,
      vatValue: 200,
      grossValue: 1_200,
    });
    expect(() =>
      validateInboundInvoiceTotals({
        netValue: 1_000,
        vatValue: 200,
        grossValue: 1_199,
      }),
    ).toThrow(/mora biti jednaka/);
  });

  it("allocates every linked invoice cent by purchase-order line value", () => {
    const allocations = allocateInvoiceCostsByOrderValue(100.01, [
      { id: "a", sku: "A", qty: 1, purchasePrice: 100 },
      { id: "b", sku: "B", qty: 1, purchasePrice: 200 },
    ]);
    expect(allocations.get("a")).toBe(33.34);
    expect(allocations.get("b")).toBe(66.67);
    expect(
      Array.from(allocations.values()).reduce((sum, value) => sum + value, 0),
    ).toBeCloseTo(100.01, 2);
  });

  it("allocates a negative invoice correction without double-counting PO costs", () => {
    const allocations = allocateInvoiceCostsByOrderValue(-100, [
      { id: "a", sku: "A", qty: 1, purchasePrice: 100 },
      { id: "b", sku: "B", qty: 1, purchasePrice: 100 },
    ]);
    expect(allocations).toEqual(
      new Map([
        ["a", -50],
        ["b", -50],
      ]),
    );
  });

  it("raspoređuje transport i ostale troškove po zapremini, a carinu po stopi", () => {
    const allocations = allocateActualInboundCosts({
      costs: {
        invoiceValueRsd: 2_000,
        customsValueRsd: 100,
        transportValueRsd: 1_000,
        otherRelatedCostsRsd: 100,
      },
      otherCostsBasis: "VOLUME",
      lines: [
        {
          id: "a",
          sku: "A",
          qty: 10,
          purchaseValueRsd: 1_000,
          customsRatePct: 10,
          transportBaselineRsd: 90,
          totalVolumeM3: 9,
          totalWeightKg: 1,
        },
        {
          id: "b",
          sku: "B",
          qty: 10,
          purchaseValueRsd: 1_000,
          customsRatePct: 0,
          transportBaselineRsd: 10,
          totalVolumeM3: 1,
          totalWeightKg: 9,
        },
      ],
    });

    expect(allocations).toEqual([
      expect.objectContaining({
        id: "a",
        invoiceValueRsd: 1_000,
        customsRsd: 100,
        transportRsd: 900,
        otherRelatedCostsRsd: 90,
        totalActualCostRsd: 2_090,
        adjustmentRsd: 900,
        incomingUnitCogsRsd: 209,
      }),
      expect.objectContaining({
        id: "b",
        invoiceValueRsd: 1_000,
        customsRsd: 0,
        transportRsd: 100,
        otherRelatedCostsRsd: 10,
        totalActualCostRsd: 1_110,
        adjustmentRsd: 100,
        incomingUnitCogsRsd: 111,
      }),
    ]);
    expect(
      allocations.reduce((sum, line) => sum + line.totalActualCostRsd, 0),
    ).toBe(3_200);
  });

  it("grupiše duple SKU stavke i zadržava usaglašenje do pare", () => {
    const grouped = groupActualInboundCostsBySku(
      allocateActualInboundCosts({
        costs: {
          invoiceValueRsd: 100.01,
          customsValueRsd: 0,
          transportValueRsd: 0,
          otherRelatedCostsRsd: 0,
        },
        otherCostsBasis: "VALUE",
        lines: [
          { id: "a", sku: "A", qty: 1, purchaseValueRsd: 50 },
          { id: "b", sku: "A", qty: 1, purchaseValueRsd: 50 },
        ],
      }),
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toEqual(
      expect.objectContaining({
        sku: "A",
        qty: 2,
        totalActualCostRsd: 100.01,
        incomingUnitCogsRsd: 50.01,
      }),
    );
  });

  it("calculates incoming unit COGS by SKU from order and linked costs", () => {
    expect(
      calculateCogsBySku({
        orderExchangeRate: 1,
        linkedInvoiceCostRsd: 300,
        lines: [
          { id: "a", sku: "A", qty: 10, purchasePrice: 100 },
          { id: "b", sku: "B", qty: 10, purchasePrice: 200 },
        ],
      }),
    ).toEqual([
      {
        sku: "A",
        qty: 10,
        orderValueRsd: 1_000,
        customsRsd: 0,
        otherAllocatedRsd: 0,
        linkedInvoiceCostRsd: 100,
        incomingUnitCogsRsd: 110,
      },
      {
        sku: "B",
        qty: 10,
        orderValueRsd: 2_000,
        customsRsd: 0,
        otherAllocatedRsd: 0,
        linkedInvoiceCostRsd: 200,
        incomingUnitCogsRsd: 220,
      },
    ]);
  });

  it("writes the client's weighted-average example as 193.33 RSD", () => {
    expect(
      weightedAverageCogs({
        existingQty: 100,
        existingUnitCogs: 200,
        incomingQty: 50,
        incomingUnitCogs: 180,
      }),
    ).toBe(193.33);
  });
});
