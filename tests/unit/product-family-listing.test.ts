import { describe, expect, it } from "vitest";
import { applyFilters, computeFacetValues, emptyFilterState } from "@/lib/listing/filters";
import type { Product } from "@/types";

const product = {
  sku: "CHAIR-BLACK",
  slug: "chair-black",
  name: "Stolica",
  group: "stolice",
  categoryPath: ["Nameštaj", "Stolice"],
  description: "",
  dimensionsCm: { w: 50, d: 50, h: 80 },
  materials: [],
  pictograms: [],
  stock: 1,
  incomingStock: 0,
  fullPrice: 5000,
  deliveryDays: { min: 3, max: 5 },
  allowsAssembly: false,
  assemblyCities: [],
  media: { images: [] },
  recommendedSkus: [],
  frequentlyBoughtSkus: [],
  variantFamily: {
    id: "chairs",
    code: "CHAIR",
    primarySku: "CHAIR-BLACK",
    selectedSku: "CHAIR-BLACK",
    options: [
      {
        sku: "CHAIR-BLACK",
        slug: "chair-black",
        name: "Stolica",
        label: "Crna",
        position: 0,
        isPrimary: true,
        media: { images: [] },
        fullPrice: 5000,
        stock: 1,
        incomingStock: 0,
        deliveryDays: { min: 3, max: 5 },
      },
      {
        sku: "CHAIR-GREEN",
        slug: "chair-green",
        name: "Stolica",
        label: "Zelena",
        position: 1,
        isPrimary: false,
        media: { images: [] },
        fullPrice: 5000,
        stock: 2,
        incomingStock: 0,
        deliveryDays: { min: 3, max: 5 },
      },
    ],
  },
} as Product;

describe("family-aware filter boje", () => {
  it("objavljuje sve family boje kao facete", () => {
    expect(computeFacetValues([product]).colors).toEqual(["Crna", "Zelena"]);
  });

  it("zadržava jednu karticu i unapred bira boju koja odgovara filteru", () => {
    const result = applyFilters([product], {
      ...emptyFilterState(),
      colors: ["Zelena"],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.variantFamily?.selectedSku).toBe("CHAIR-GREEN");
  });
});
