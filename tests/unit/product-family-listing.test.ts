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

const greenChair = {
  ...product,
  sku: "CHAIR-GREEN",
  slug: "chair-green",
  colorPrimary: "Zelena",
  variantFamily: {
    ...product.variantFamily!,
    selectedSku: "CHAIR-GREEN",
  },
} as Product;

const greenTable = {
  ...product,
  sku: "TABLE-GREEN",
  slug: "table-green",
  name: "Sto",
  group: "trpezarijski-stolovi",
  categoryPath: ["Nameštaj", "Trpezarijski stolovi"],
  colorPrimary: "Zelena",
  attributes: ["SKLOPIVO", "ZA 4 OSOBE"],
  variantFamily: undefined,
} as Product;

const oakChair = {
  ...product,
  sku: "CHAIR-OAK",
  slug: "chair-oak",
  colorPrimary: "Natur",
  attributes: ["SKLOPIVO"],
  materials: [{ id: "oak", label: "Hrast" }],
  variantFamily: undefined,
} as Product;

describe("SKU-level filter boje", () => {
  it("računa svaku objavljenu family boju kao zaseban artikal", () => {
    const facets = computeFacetValues([product, greenChair]);

    expect(facets.colors).toEqual(["Crna", "Zelena"]);
    expect(facets.counts.colors).toEqual({ Crna: 1, Zelena: 1 });
  });

  it("filter zadržava samo karticu konkretnog SKU-a bez prebacivanja druge kartice", () => {
    const result = applyFilters([product, greenChair], {
      ...emptyFilterState(),
      colors: ["Zelena"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.sku).toBe("CHAIR-GREEN");
    expect(result[0]?.variantFamily?.selectedSku).toBe("CHAIR-GREEN");
  });
});

describe("dinamički filteri listinga", () => {
  it("izvodi grupe, boje i atribute samo iz prosleđenih artikala", () => {
    const facets = computeFacetValues([greenTable, oakChair]);

    expect(facets.groups).toEqual(["stolice", "trpezarijski-stolovi"]);
    expect(facets.groupLabels).toMatchObject({
      stolice: "Stolice",
      "trpezarijski-stolovi": "Trpezarijski stolovi",
    });
    expect(facets.colors).toEqual(["Natur", "Zelena"]);
    expect(facets.attributes).toEqual(["SKLOPIVO", "ZA 4 OSOBE"]);
    expect(facets.counts.attributes).toEqual({ SKLOPIVO: 2, "ZA 4 OSOBE": 1 });
  });

  it("dozvoljava više grupa i atributa, sa OR logikom unutar jedne facete", () => {
    const result = applyFilters([product, greenTable, oakChair], {
      ...emptyFilterState(),
      groups: ["stolice", "trpezarijski-stolovi"],
      attributes: ["ZA 4 OSOBE", "SKLOPIVO"],
    });

    expect(result.map((item) => item.sku)).toEqual(["TABLE-GREEN", "CHAIR-OAK"]);
  });

  it("kombinuje različite facete AND logikom", () => {
    const result = applyFilters([greenTable, oakChair], {
      ...emptyFilterState(),
      attributes: ["SKLOPIVO"],
      colors: ["zelena"],
    });

    expect(result.map((item) => item.sku)).toEqual(["TABLE-GREEN"]);
  });
});
