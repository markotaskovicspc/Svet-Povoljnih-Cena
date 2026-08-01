import { describe, expect, it } from "vitest";
import { selectApplicableLoyaltyRule } from "@/lib/pricing/loyalty-scope";

const base = {
  discountPct: 5,
  priority: 1,
  updatedAt: "2026-08-01T10:00:00.000Z",
} as const;

describe("loyalty product scope", () => {
  it("does not treat an empty selected scope as all products", () => {
    expect(
      selectApplicableLoyaltyRule("p1", [
        { ...base, id: "selected", scope: "SELECTED_PRODUCTS", productIds: [] },
      ]),
    ).toBeNull();
  });

  it("matches selected and all-product rules", () => {
    expect(
      selectApplicableLoyaltyRule("p1", [
        { ...base, id: "selected", scope: "SELECTED_PRODUCTS", productIds: ["p1"] },
      ])?.id,
    ).toBe("selected");
    expect(
      selectApplicableLoyaltyRule("p2", [
        { ...base, id: "all", scope: "ALL_PRODUCTS", productIds: [] },
      ])?.id,
    ).toBe("all");
  });

  it("uses priority and then newest update for overlaps", () => {
    const selected = selectApplicableLoyaltyRule("p1", [
      { ...base, id: "older", scope: "ALL_PRODUCTS", productIds: [] },
      {
        ...base,
        id: "newer",
        discountPct: 7,
        priority: 2,
        updatedAt: "2026-08-01T11:00:00.000Z",
        scope: "SELECTED_PRODUCTS",
        productIds: ["p1"],
      },
    ]);
    expect(selected?.id).toBe("newer");
  });
});
