import { describe, expect, it } from "vitest";
import { comparePromoRank, promoKeyForQuery, readPromoProductOrder, STANDARD_PROMO_PAGES } from "@/lib/storefront/promo-product-order";
import { applySort } from "@/lib/listing/filters";
import type { Product } from "@/types";

describe("standard promo product ordering", () => {
  it("maps each standard landing editor to its live catalog query", () => {
    for (const page of STANDARD_PROMO_PAGES) expect(promoKeyForQuery(page.query)).toBe(page.key);
    expect(promoKeyForQuery({ categoryPath: "/namestaj" })).toBeUndefined();
    expect(promoKeyForQuery({ actionSlug: "custom-campaign" })).toBeUndefined();
  });
  it("rejects corrupt or repeated SKUs and supports returning to automatic order", () => {
    expect(readPromoProductOrder(["B", "A"])).toEqual(["B", "A"]);
    expect(readPromoProductOrder(["B", "B"])).toEqual([]);
    expect(readPromoProductOrder({ skus: ["B"] })).toEqual([]);
    expect(readPromoProductOrder([])).toEqual([]);
  });
  it("leaves new catalog entries after the manual selection in stable order", () => {
    const ranks = new Map([["B", 0], ["A", 1]]);
    expect(["C", "A", "D", "B"].sort((a,b) => comparePromoRank(a,b,ranks))).toEqual(["B", "A", "C", "D"]);
  });
  it("preserves server manual ranks after hydration while price sorting still works", () => {
    const products = [
      { sku: "A", fullPrice: 100, promoSortPosition: 1, discountPct: 90 },
      { sku: "B", fullPrice: 200, promoSortPosition: 0, discountPct: 0 },
    ] as Product[];
    expect(applySort(products, "default", "heroji-meseca").map(p=>p.sku)).toEqual(["B", "A"]);
    expect(applySort(products, "price-asc", "heroji-meseca").map(p=>p.sku)).toEqual(["A", "B"]);
  });
});
