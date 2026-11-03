import { describe, expect, it } from "vitest";
import { recommendationRuleMatchesProduct, selectCartRecommendationRules } from "@/lib/cart-recommendations";

const cart = [
  { id: "chair", sku: "CHAIR-1", groupId: "chairs" },
  { id: "table", sku: "TABLE-1", groupId: "tables" },
];

describe("izbor pravila preporuke kupovine", () => {
  const oven = { id: "oven", sku: "210007", groupId: "ovens", categoryPaths: ["/mali-kucni-aparati/kuvanje-i-pecenje"] };
  const categoryRule = { id: "kettle-for-appliances", groupId: null, sourceProductId: null, category: { path: "/mali-kucni-aparati" }, order: 0 };

  it("primenjuje preporuku kuvala na rernu iz potkategorije sa drugom internom grupom", () => {
    expect(selectCartRecommendationRules([oven], [categoryRule])).toEqual([categoryRule]);
    expect(recommendationRuleMatchesProduct(oven, categoryRule)).toBe(true);
  });

  it("prepoznaje samu kategoriju, ali ne sličan prefiks ili drugu kategoriju", () => {
    expect(recommendationRuleMatchesProduct({ ...oven, categoryPaths: ["/mali-kucni-aparati"] }, categoryRule)).toBe(true);
    expect(selectCartRecommendationRules([{ ...oven, categoryPaths: ["/mali-kucni-aparati-dodaci"] }], [categoryRule])).toEqual([]);
    expect(selectCartRecommendationRules([cart[0]], [categoryRule])).toEqual([]);
  });

  it("daje prednost pravilu interne grupe nad kategorijom", () => {
    const group = { id: "oven-group", groupId: "ovens", sourceProductId: null, order: 10 };
    expect(selectCartRecommendationRules([oven], [categoryRule, group])).toEqual([group]);
  });

  it("daje prednost konkretnom artiklu nad grupom i kategorijom", () => {
    const group = { id: "oven-group", groupId: "ovens", sourceProductId: null, order: 0 };
    const exact = { id: "oven-only", groupId: null, sourceProductId: "oven", order: 10 };
    expect(selectCartRecommendationRules([oven], [categoryRule, group, exact])).toEqual([exact]);
  });

  it("bira najužu kategoriju i ne duplira je za više artikala", () => {
    const narrow = { ...categoryRule, id: "cooking", category: { path: "/mali-kucni-aparati/kuvanje-i-pecenje" }, order: 10 };
    expect(selectCartRecommendationRules([oven, { ...oven, id: "oven-2", sku: "210009" }], [categoryRule, narrow])).toEqual([narrow]);
  });

  it("daje prednost pravilu konkretnog artikla nad pravilom grupe", () => {
    const selected = selectCartRecommendationRules([cart[0]], [
      {
        id: "group-rule",
        groupId: "chairs",
        sourceProductId: null,
        order: 0,
      },
      {
        id: "product-rule",
        groupId: null,
        sourceProductId: "chair",
        order: 10,
      },
    ]);

    expect(selected.map((rule) => rule.id)).toEqual(["product-rule"]);
  });

  it("zadržava postojeće grupno pravilo kada artikal nema svoje", () => {
    const selected = selectCartRecommendationRules([cart[0]], [
      {
        id: "group-rule",
        groupId: "chairs",
        sourceProductId: null,
        order: 0,
      },
    ]);

    expect(selected.map((rule) => rule.id)).toEqual(["group-rule"]);
  });

  it("poštuje redosled artikala u korpi i ne vraća isto grupno pravilo dvaput", () => {
    const selected = selectCartRecommendationRules(
      [cart[1], cart[0], { id: "chair-2", sku: "CHAIR-2", groupId: "chairs" }],
      [
        {
          id: "chair-group",
          groupId: "chairs",
          sourceProductId: null,
          order: 0,
        },
        {
          id: "table-group",
          groupId: "tables",
          sourceProductId: null,
          order: 0,
        },
      ],
    );

    expect(selected.map((rule) => rule.id)).toEqual([
      "table-group",
      "chair-group",
    ]);
  });
});
