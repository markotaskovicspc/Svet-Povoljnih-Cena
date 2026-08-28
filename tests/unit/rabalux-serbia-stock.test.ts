import { describe, expect, it } from "vitest";
import {
  RABALUX_SERBIA_STOCK_FEED_URL,
  assertRabaluxSerbiaStockSource,
  isRabaluxSerbiaStockPresent,
  isRabaluxSerbiaWebStockAvailable,
  selectRabaluxSerbiaStockCatalog,
} from "@/lib/rabalux/serbia-stock";
import type { RabaluxCatalogItem, RabaluxStockItem } from "@/lib/rabalux/types";

function catalogItem(sourceSku: string) {
  return { sourceSku } as RabaluxCatalogItem;
}

function stockItem(
  sourceSku: string,
  stock: number,
  restricted = false,
): RabaluxStockItem {
  return {
    sourceSku,
    stock,
    status: restricted ? "restricted" : "",
    outgoing: false,
    restricted,
    nextArrivalAt: null,
  };
}

describe("Rabalux Serbia stock-only catalog policy", () => {
  it("accepts only the exact authenticated Serbia stock endpoint", () => {
    expect(() =>
      assertRabaluxSerbiaStockSource({
        country: "RS",
        stockFeedUrl: RABALUX_SERBIA_STOCK_FEED_URL,
      }),
    ).not.toThrow();

    expect(() =>
      assertRabaluxSerbiaStockSource({
        country: "RS",
        stockFeedUrl: "https://rabalux.hu/downloadmanager/downloadha/nohtml/1/id/11",
      }),
    ).toThrow("restricted to the Serbia feed");
    expect(() =>
      assertRabaluxSerbiaStockSource({
        country: "HU",
        stockFeedUrl: RABALUX_SERBIA_STOCK_FEED_URL,
      }),
    ).toThrow("configured for Serbia");
  });

  it("imports every positive unrestricted Serbian SKU and publishes at 3 or more", () => {
    const selection = selectRabaluxSerbiaStockCatalog(
      ["AVAILABLE", "THRESHOLD", "LOW", "ZERO", "RESTRICTED", "MISSING"].map(
        catalogItem,
      ),
      [
        stockItem("AVAILABLE", 11),
        stockItem("THRESHOLD", 10),
        stockItem("LOW", 1),
        stockItem("ZERO", 0),
        stockItem("RESTRICTED", 50, true),
      ],
    );

    expect(selection.items.map((item) => item.sourceSku)).toEqual([
      "AVAILABLE",
      "THRESHOLD",
      "LOW",
    ]);
    expect(selection).toMatchObject({
      rawCatalogRows: 6,
      stockRows: 5,
      excludedMissingStock: 1,
      excludedWithoutStock: 1,
      excludedRestricted: 1,
      excludedBySerbiaStockPolicy: 3,
    });
    expect(isRabaluxSerbiaStockPresent(stockItem("A", 1))).toBe(true);
    expect(isRabaluxSerbiaStockPresent(stockItem("A", 0))).toBe(false);
    expect(isRabaluxSerbiaStockPresent(stockItem("A", 20, true))).toBe(false);
    expect(isRabaluxSerbiaWebStockAvailable(stockItem("A", 2))).toBe(false);
    expect(isRabaluxSerbiaWebStockAvailable(stockItem("A", 3))).toBe(true);
  });

  it("fails closed instead of combining duplicate warehouse rows", () => {
    expect(() =>
      selectRabaluxSerbiaStockCatalog(
        [catalogItem("A")],
        [stockItem("A", 6), stockItem("A", 6)],
      ),
    ).toThrow("refusing to combine warehouse rows");
  });
});
