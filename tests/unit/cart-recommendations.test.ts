import { describe, expect, it } from "vitest";
import { selectCartRecommendationRules } from "@/lib/cart-recommendations";

const cart = [
  { id: "chair", sku: "CHAIR-1", groupId: "chairs" },
  { id: "table", sku: "TABLE-1", groupId: "tables" },
];

describe("izbor pravila preporuke kupovine", () => {
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
