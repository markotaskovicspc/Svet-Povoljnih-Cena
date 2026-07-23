import { describe, expect, it } from "vitest";
import {
  allocateInvoiceCostsByOrderValue,
  calculateCogsBySku,
  validateInboundInvoiceTotals,
  weightedAverageCogs,
} from "@/lib/admin/inbound-invoice";

describe("ERP module 5 inbound invoices and COGS", () => {
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
