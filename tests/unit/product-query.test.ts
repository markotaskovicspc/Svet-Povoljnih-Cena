import { describe, expect, it } from "vitest";
import { parseListProductsInput } from "@/lib/api/product-query";

describe("product list query parsing", () => {
  it("does not turn an omitted or blank max price into zero", () => {
    expect(parseListProductsInput(new URLSearchParams()).maxPrice).toBeUndefined();
    expect(
      parseListProductsInput(new URLSearchParams({ maxPrice: "  " })).maxPrice,
    ).toBeUndefined();
  });

  it("keeps explicit finite numeric filters", () => {
    const input = parseListProductsInput(
      new URLSearchParams({ maxPrice: "15000", limit: "12" }),
    );

    expect(input.maxPrice).toBe(15_000);
    expect(input.limit).toBe(12);
  });

  it("falls back safely for invalid numbers", () => {
    const input = parseListProductsInput(
      new URLSearchParams({ maxPrice: "not-a-number", limit: "NaN" }),
    );

    expect(input.maxPrice).toBeUndefined();
    expect(input.limit).toBe(36);
  });

  it("parses the permanent protected-price filter for paginated listings", () => {
    expect(
      parseListProductsInput(
        new URLSearchParams({ permanentOnly: "true" }),
      ).permanentOnly,
    ).toBe(true);
    expect(
      parseListProductsInput(
        new URLSearchParams({ permanentOnly: "false" }),
      ).permanentOnly,
    ).toBe(false);
  });

  it("parses repeated complete-listing facets without comma splitting", () => {
    const params = new URLSearchParams();
    params.append("groups", "stolice");
    params.append("groups", "trpezarijski-stolovi");
    params.append("colors", "crna, mat");
    params.append("attributes", "SKLOPIVO");
    params.append("availability", "in-stock");
    params.append("availability", "invalid");
    params.append("dynamic.tip", "Ugaona");
    params.set("priceMin", "1000");
    params.set("priceMax", "25000");

    expect(parseListProductsInput(params)).toMatchObject({
      groupSlugs: ["stolice", "trpezarijski-stolovi"],
      colors: ["crna, mat"],
      attributes: ["SKLOPIVO"],
      availability: ["in-stock"],
      dynamicFilters: { tip: ["Ugaona"] },
      priceRange: [1000, 25000],
    });
  });

  it("ignores incomplete or reversed ranges", () => {
    expect(
      parseListProductsInput(
        new URLSearchParams({ widthMin: "100", widthMax: "50" }),
      ).widthRange,
    ).toBeUndefined();
    expect(
      parseListProductsInput(new URLSearchParams({ widthMin: "50" })).widthRange,
    ).toBeUndefined();
  });
});
