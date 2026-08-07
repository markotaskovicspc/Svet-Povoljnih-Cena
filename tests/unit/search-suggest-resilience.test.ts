import { describe, expect, it } from "vitest";
import {
  mergeSearchSuggestionSources,
  SearchUnavailableError,
} from "@/lib/api/search";
import type { SearchHit, SearchNavigationHit } from "@/types/search";

const product: SearchHit = {
  type: "product",
  href: "/p/test-fotelja",
  sku: "TEST-1",
  slug: "test-fotelja",
  name: "Fotelja CUBE",
  breadcrumb: "Dnevna soba",
  thumbnailUrl: "",
  fullPrice: 22_856,
  salePrice: 22_856,
  discountPct: 0,
  isHero: false,
};

const category: SearchNavigationHit = {
  type: "category",
  id: "living-room",
  name: "Dnevna soba",
  href: "/k/dnevna-soba",
  breadcrumb: "Kategorija",
};

describe("search suggestion resilience", () => {
  it("keeps product suggestions when navigation lookup fails", () => {
    const result = mergeSearchSuggestionSources(
      { status: "rejected", reason: new Error("navigation unavailable") },
      { status: "fulfilled", value: [product] },
    );

    expect(result).toEqual({ hits: [product], degraded: true });
  });

  it("keeps navigation before products when both sources succeed", () => {
    const result = mergeSearchSuggestionSources(
      { status: "fulfilled", value: [category] },
      { status: "fulfilled", value: [product] },
    );

    expect(result).toEqual({ hits: [category, product], degraded: false });
  });

  it("fails the suggestion request when the core product lookup fails", () => {
    expect(() =>
      mergeSearchSuggestionSources(
        { status: "fulfilled", value: [category] },
        { status: "rejected", reason: new Error("products unavailable") },
      ),
    ).toThrow(SearchUnavailableError);
  });
});
