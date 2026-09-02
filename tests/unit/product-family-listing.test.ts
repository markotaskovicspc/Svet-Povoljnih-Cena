import { describe, expect, it } from "vitest";
import {
  appendFilterQueryParams,
  applyFilters,
  applySort,
  computeExtents,
  computeFacetValues,
  emptyFilterState,
  matchesListingSubTab,
  resolveListingProducts,
  sortFacetValuesByCount,
} from "@/lib/listing/filters";
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
        colorHex: "#111111",
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
        colorHex: "#228833",
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

describe("filter dostupnosti", () => {
  it("nikad ne svrstava Rabalux u robu u dolasku", () => {
    const ownIncoming = {
      ...product,
      sku: "OWN-INCOMING",
      stock: 0,
      incomingStock: 4,
      supplierIntegrationKey: "SPC",
      variantFamily: undefined,
    } as Product;
    const rabaluxIncoming = {
      ...ownIncoming,
      sku: "RABALUX-INCOMING",
      supplierIntegrationKey: "RABALUX",
    } as Product;
    const state = { ...emptyFilterState(), availability: ["incoming" as const] };

    expect(computeFacetValues([ownIncoming, rabaluxIncoming]).counts.availability)
      .toEqual({ "in-stock": 0, incoming: 1, "out-of-stock": 1 });
    expect(applyFilters([ownIncoming, rabaluxIncoming], state).map((item) => item.sku))
      .toEqual(["OWN-INCOMING"]);
  });
});

describe("dinamički filteri listinga", () => {
  it("sortira fiksne facete opadajuće po broju, pa po srpskoj latinici", () => {
    expect(
      sortFacetValuesByCount(
        ["Žuta", "Crvena", "Čelik", "Bela"],
        { Žuta: 2, Crvena: 4, Čelik: 2, Bela: 1 },
      ),
    ).toEqual(["Crvena", "Čelik", "Žuta", "Bela"]);

    const secondGreenTable = {
      ...greenTable,
      sku: "TABLE-GREEN-2",
      slug: "table-green-2",
    } as Product;
    const facets = computeFacetValues([oakChair, greenTable, secondGreenTable]);
    expect(facets.groups).toEqual(["trpezarijski-stolovi", "stolice"]);
    expect(facets.colors).toEqual(["Zelena", "Natur"]);
    expect(facets.attributes).toEqual(["SKLOPIVO", "ZA 4 OSOBE"]);
  });

  it("lokalni filter i sortiranje koriste najnižu javno prikazanu krajnju cenu", () => {
    const fullPriceOnly = {
      ...product,
      sku: "FULL-PRICE",
      fullPrice: 1_500,
      variantFamily: undefined,
    } as Product;
    const activeAction = {
      ...product,
      sku: "ACTIVE-ACTION",
      fullPrice: 2_000,
      salePrice: 1_400,
      action: {
        id: "action",
        name: "Aktivna akcija",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2100-01-01T00:00:00.000Z",
      },
      variantFamily: undefined,
    } as Product;
    const expiredAction = {
      ...activeAction,
      sku: "EXPIRED-ACTION",
      fullPrice: 3_000,
      salePrice: 900,
      action: {
        ...activeAction.action!,
        endsAt: "2020-01-01T00:00:00.000Z",
      },
    } as Product;
    const loyaltyOffer = {
      ...product,
      sku: "LOYALTY-OFFER",
      fullPrice: 4_000,
      loyaltyPrice: 1_200,
      loyaltyDiscountPct: 70,
      variantFamily: undefined,
    } as Product;
    const products = [expiredAction, fullPriceOnly, activeAction, loyaltyOffer];

    expect(computeExtents(products).price).toEqual([1_000, 3_000]);
    expect(
      applyFilters(products, {
        ...emptyFilterState(),
        price: [1_000, 1_299],
      }).map((item) => item.sku),
    ).toEqual(["LOYALTY-OFFER"]);
    expect(applySort(products, "price-asc", "kategorija").map((item) => item.sku))
      .toEqual([
        "LOYALTY-OFFER",
        "ACTIVE-ACTION",
        "FULL-PRICE",
        "EXPIRED-ACTION",
      ]);
  });

  it("zadržava Heroje meseca na vrhu kod svake ponuđene vrste sortiranja", () => {
    const regularCheap = {
      ...product,
      sku: "REGULAR-CHEAP",
      fullPrice: 500,
      discountPct: 80,
      variantFamily: undefined,
    } as Product;
    const heroExpensive = {
      ...product,
      sku: "HERO-EXPENSIVE",
      isHero: true,
      fullPrice: 10_000,
      discountPct: 5,
      variantFamily: undefined,
    } as Product;

    for (const sort of [
      "default",
      "price-asc",
      "price-desc",
      "discount-desc",
    ] as const) {
      expect(
        applySort([regularCheap, heroExpensive], sort, "akcija").map(
          (item) => item.sku,
        ),
      ).toEqual(["HERO-EXPENSIVE", "REGULAR-CHEAP"]);
    }
  });

  it("podtab prepoznaje proizvod po nazivu kada je kategorija šira", () => {
    expect(
      matchesListingSubTab(
        { ...oakChair, name: "Kancelarijska stolica ERGO" },
        {
          id: "stolice",
          label: "Stolice",
          matchKeyword: "stolic",
          matchField: "name",
        },
      ),
    ).toBe(true);
  });

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

  it("prosleđuje sve izabrane facete cursor API-ju", () => {
    const params = appendFilterQueryParams(
      new URLSearchParams("categoryPath=/namestaj"),
      {
        ...emptyFilterState(),
        groups: ["stolice", "stolovi"],
        colors: ["Crna"],
        attributes: ["SKLOPIVO"],
        price: [1000, 9000],
        dimensions: { w: [40, 120] },
        dynamic: { tip: ["Ravna", "Ugaona"] },
      },
      "price-asc",
      "trpezar",
    );

    expect(params.getAll("groups")).toEqual(["stolice", "stolovi"]);
    expect(params.getAll("dynamic.tip")).toEqual(["Ravna", "Ugaona"]);
    expect(params.get("priceMin")).toBe("1000");
    expect(params.get("widthMax")).toBe("120");
    expect(params.get("sort")).toBe("price-asc");
    expect(params.get("categoryKeyword")).toBe("trpezar");
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

  it("ne filtrira ponovo rezultate koje je API već rešio nad celom kategorijom", () => {
    const result = resolveListingProducts(
      [product],
      { ...emptyFilterState(), price: [1, 100] },
      "price-desc",
      "kategorija",
      true,
    );

    expect(result).toEqual([product]);
  });

  it("ne tretira dimenzijsku family oznaku kao boju", () => {
    const sizeVariant = {
      ...product,
      sku: "BED-190X80",
      colorPrimary: undefined,
      variantFamily: {
        ...product.variantFamily!,
        selectedSku: "BED-190X80",
        options: [
          {
            ...product.variantFamily!.options[0]!,
            sku: "BED-190X80",
            label: "190x80",
            colorHex: undefined,
          },
        ],
      },
    } as Product;

    expect(computeFacetValues([sizeVariant]).colors).toEqual([]);
  });

  it("odbacuje dimenziju koju je import pogrešno upisao u colorPrimary", () => {
    const malformedColor = {
      ...greenTable,
      colorPrimary: "190x80",
    } as Product;

    expect(computeFacetValues([malformedColor]).colors).toEqual([]);
  });
});
