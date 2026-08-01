import { describe, expect, it } from "vitest";
import {
  pricingRuleInputsForProduct,
  type ActivePricingRules,
} from "@/lib/pricing/rules";

const baseRules: ActivePricingRules = {
  evaluatedAt: "2026-08-02T10:00:00.000Z",
  loyaltyRules: [
    {
      id: "global-loyalty",
      discountPct: 12,
      priority: 10,
      updatedAt: "2026-08-02T09:00:00.000Z",
    },
  ],
  linearPromotions: [],
};

describe("active pricing rule scope", () => {
  it("applies the active loyalty rule to every product", () => {
    expect(
      pricingRuleInputsForProduct({ id: "product-a" }, baseRules)
        .loyaltyDiscountPct,
    ).toBe(12);
    expect(
      pricingRuleInputsForProduct({ id: "product-b" }, baseRules)
        .loyaltyDiscountPct,
    ).toBe(12);
  });

  it("matches linear rules for all products, category descendants, and groups", () => {
    const rules: ActivePricingRules = {
      ...baseRules,
      linearPromotions: [
        {
          id: "all",
          name: "Ceo asortiman",
          discountPct: 2,
          priority: 1,
          startsAt: "2026-08-01T00:00:00.000Z",
          endsAt: "2026-08-31T23:59:00.000Z",
          categoryIds: [],
          categoryPaths: [],
          groupIds: [],
        },
        {
          id: "category",
          name: "Rasveta",
          discountPct: 5,
          priority: 2,
          startsAt: "2026-08-01T00:00:00.000Z",
          endsAt: "2026-08-31T23:59:00.000Z",
          categoryIds: ["category-lighting"],
          categoryPaths: ["rasveta"],
          groupIds: [],
        },
        {
          id: "group",
          name: "Pametna rasveta",
          discountPct: 8,
          priority: 3,
          startsAt: "2026-08-01T00:00:00.000Z",
          endsAt: "2026-08-31T23:59:00.000Z",
          categoryIds: [],
          categoryPaths: [],
          groupIds: ["group-smart"],
        },
      ],
    };

    const result = pricingRuleInputsForProduct(
      {
        categoryIds: ["subcategory-ceiling"],
        categoryPaths: ["rasveta/plafonjere"],
        groupId: "group-smart",
      },
      rules,
    );

    expect(result.linearPromotions.map((promotion) => promotion.name)).toEqual([
      "Ceo asortiman",
      "Rasveta",
      "Pametna rasveta",
    ]);
  });
});
