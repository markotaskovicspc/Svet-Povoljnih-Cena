import { describe, expect, it } from "vitest";
import {
  allocateFreight,
  allocateLandedCost,
  weightedAverageUnitCost,
} from "@/lib/admin/po";

describe("purchase-order freight allocation", () => {
  it("allocates freight proportionally to line purchase value", () => {
    const result = allocateFreight(300, [
      { id: "a", purchasePrice: 100, qty: 1 },
      { id: "b", purchasePrice: 200, qty: 1 },
    ]);
    expect(result.get("a")).toBe(100);
    expect(result.get("b")).toBe(200);
  });

  it("does not divide by zero for empty-value orders", () => {
    const result = allocateFreight(300, [
      { id: "a", purchasePrice: 0, qty: 1 },
    ]);
    expect(result.get("a")).toBe(0);
  });

  it("uses normalised greater weight/volume utilisation by default and reconciles cents", () => {
    const result = allocateLandedCost(100.01, [
      {
        id: "heavy",
        purchasePrice: 100,
        qty: 1,
        totalWeight: 90,
        totalVolume: 1,
      },
      {
        id: "bulky",
        purchasePrice: 100,
        qty: 1,
        totalWeight: 10,
        totalVolume: 9,
      },
    ]);
    expect((result.get("heavy") ?? 0) + (result.get("bulky") ?? 0)).toBeCloseTo(100.01, 2);
    expect(result.get("heavy")).toBe(50.01);
    expect(result.get("bulky")).toBe(50);
  });

  it("rejects a manual allocation that does not reconcile exactly", () => {
    expect(() =>
      allocateLandedCost(
        100,
        [
          { id: "a", purchasePrice: 1, qty: 1, manualAmount: 40 },
          { id: "b", purchasePrice: 1, qty: 1, manualAmount: 50 },
        ],
        "MANUAL",
      ),
    ).toThrow(/tačno/);
  });

  it("weights existing and incoming stock COGS", () => {
    expect(
      weightedAverageUnitCost({
        existingQty: 100,
        existingUnitCost: 200,
        incomingQty: 50,
        incomingUnitCost: 180,
      }),
    ).toBeCloseTo(193.33, 2);
  });
});
