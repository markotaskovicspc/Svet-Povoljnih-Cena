import { describe, expect, it } from "vitest";
import {
  allocateInvoiceCostsByOrderValue,
  assertInboundInvoicePurchaseOrderLocked,
  calculateInboundInvoiceAmounts,
  calculateLinkedInvoiceAdjustmentRsd,
  calculatePurchaseOrderInvoiceDefaults,
  calculateCogsBySku,
  resolveInboundReceiptWarehouse,
  validateInboundInvoiceTotals,
  weightedAverageCogs,
} from "@/lib/admin/inbound-invoice";

describe("ERP module 5 inbound invoices and COGS", () => {
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

  it("turns a complete COGS invoice into only the adjustment over the PO baseline", () => {
    expect(
      calculateLinkedInvoiceAdjustmentRsd({
        purchaseOrderBaselineRsd: 8_500,
        invoices: [
          {
            netValue: 9_000,
            exchangeRate: 1,
            invoiceValueRsd: 8_500,
          },
        ],
      }),
    ).toBe(500);
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
