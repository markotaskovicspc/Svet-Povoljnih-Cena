import { describe, expect, it } from "vitest";
import {
  RABALUX_SERBIA_STOCK_FEED_URL,
  assertRabaluxSerbiaStockSource,
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

  it("imports only unrestricted Serbian SKUs above the existing web threshold", () => {
    const selection = selectRabaluxSerbiaStockCatalog(
      ["AVAILABLE", "THRESHOLD", "ZERO", "RESTRICTED", "MISSING"].map(
        catalogItem,
      ),
      [
        stockItem("AVAILABLE", 11),
        stockItem("THRESHOLD", 10),
        stockItem("ZERO", 0),
        stockItem("RESTRICTED", 50, true),
      ],
    );

    expect(selection.items.map((item) => item.sourceSku)).toEqual(["AVAILABLE"]);
    expect(selection).toMatchObject({
      rawCatalogRows: 5,
      stockRows: 4,
      excludedMissingStock: 1,
      excludedBelowThreshold: 2,
      excludedRestricted: 1,
      excludedBySerbiaStockPolicy: 4,
    });
    expect(isRabaluxSerbiaWebStockAvailable(stockItem("A", 10))).toBe(false);
    expect(isRabaluxSerbiaWebStockAvailable(stockItem("A", 11))).toBe(true);
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
