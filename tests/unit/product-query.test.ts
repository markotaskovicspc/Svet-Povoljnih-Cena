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
});
