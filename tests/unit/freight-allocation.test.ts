import { describe, expect, it } from "vitest";
import { allocateFreight } from "@/lib/admin/po";

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
});
