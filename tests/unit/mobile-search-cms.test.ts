import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOBILE_SEARCH_QUERIES,
  assertMobileSearchInternalHref,
  fallbackCurrentItems,
  mobileSearchConfigInputSchema,
  mobileSearchDestinationWindowIsLive,
  orderedAvailableProducts,
} from "@/lib/mobile-search/shared";
import { normalizeMobileShortcutHref } from "@/lib/mobile-shortcuts/shared";

function validInput() {
  return {
    currentItems: [
      { position: 1, label: "Nameštaj", destination: "href:/k/namestaj", existingImageUrl: "/one.webp" },
      { position: 2, label: "Rasveta", destination: "href:/k/rasveta", existingImageUrl: "/two.webp" },
    ],
    productSkus: ["1001", "1002", "1003", "1004"],
    frequentQueries: [...DEFAULT_MOBILE_SEARCH_QUERIES],
    viewAllDestination: "href:/akcija",
  };
}

describe("mobile search CMS validation", () => {
  it("accepts the exact 2/4/6 configuration", () => {
    expect(mobileSearchConfigInputSchema.safeParse(validInput()).success).toBe(true);
  });

  it("rejects every configuration that does not contain exactly 2/4/6 items", () => {
    const missingCurrent = validInput();
    missingCurrent.currentItems.pop();
    const missingProduct = validInput();
    missingProduct.productSkus.pop();
    const missingQuery = validInput();
    missingQuery.frequentQueries.pop();
    expect(mobileSearchConfigInputSchema.safeParse(missingCurrent).success).toBe(false);
    expect(mobileSearchConfigInputSchema.safeParse(missingProduct).success).toBe(false);
    expect(mobileSearchConfigInputSchema.safeParse(missingQuery).success).toBe(false);
  });

  it("rejects missing positions, duplicate products and duplicate queries", () => {
    const input = validInput();
    input.currentItems[1]!.position = 1;
    input.productSkus[3] = "1001";
    input.frequentQueries[5] = "AKCIJA";
    const parsed = mobileSearchConfigInputSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message).join(" ");
      expect(messages).toMatch(/pozicije 1 i 2/i);
      expect(messages).toMatch(/četiri različita proizvoda/i);
      expect(messages).toMatch(/šest različitih/i);
    }
  });

  it("rejects a query shorter than three characters and a missing destination", () => {
    const input = validInput();
    input.frequentQueries[0] = "ab";
    input.currentItems[0]!.destination = "";
    expect(mobileSearchConfigInputSchema.safeParse(input).success).toBe(false);
  });

  it("keeps unsafe destinations blocked by the shared storefront validator", () => {
    expect(() => normalizeMobileShortcutHref("/admin/mobilna-pretraga")).toThrow(/admin/i);
    expect(() => normalizeMobileShortcutHref("javascript:alert(1)")).toThrow(/HTTP/i);
    expect(() => assertMobileSearchInternalHref("https://example.com/ponuda")).toThrow(
      /internu stranicu/i,
    );
  });

  it("rejects destinations before their start or after their end", () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    expect(
      mobileSearchDestinationWindowIsLive(
        {
          startsAt: new Date("2026-08-13T11:00:00.000Z"),
          endsAt: new Date("2026-08-13T13:00:00.000Z"),
        },
        now,
      ),
    ).toBe(true);
    expect(
      mobileSearchDestinationWindowIsLive(
        {
          startsAt: new Date("2026-08-13T13:00:00.000Z"),
          endsAt: new Date("2026-08-13T14:00:00.000Z"),
        },
        now,
      ),
    ).toBe(false);
    expect(
      mobileSearchDestinationWindowIsLive(
        {
          startsAt: new Date("2026-08-13T10:00:00.000Z"),
          endsAt: new Date("2026-08-13T11:00:00.000Z"),
        },
        now,
      ),
    ).toBe(false);
  });
});

describe("mobile search storefront preparation", () => {
  it("builds the two-category fallback in source order", () => {
    expect(
      fallbackCurrentItems([
        { id: "one", slug: "namestaj", name: "Nameštaj", imageUrl: "/one.webp" },
        { id: "two", slug: "rasveta", name: "Rasveta", imageUrl: "/two.webp" },
        { id: "three", slug: "bazeni", name: "Bazeni", imageUrl: "/three.webp" },
      ]),
    ).toEqual([
      { id: "fallback-category-one", label: "Nameštaj", href: "/k/namestaj", imageUrl: "/one.webp" },
      { id: "fallback-category-two", label: "Rasveta", href: "/k/rasveta", imageUrl: "/two.webp" },
    ]);
  });

  it("preserves CMS order and drops products filtered by publication rules", () => {
    expect(
      orderedAvailableProducts(
        ["a", "b", "c", "d"],
        [{ slug: "d", sku: "4" }, { slug: "a", sku: "1" }, { slug: "c", sku: "3" }],
      ).map((product) => product.sku),
    ).toEqual(["1", "3", "4"]);
  });
});
