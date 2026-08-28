import { describe, expect, it } from "vitest";
import { landingSnapshotSchema } from "@/lib/landing-pages/blocks";
import {
  databaseLandingPageId,
  databaseLandingPageKey,
  landingPageProductSkus,
} from "@/lib/storefront/homepage-landing";

function snapshot(input: {
  template?: "BUILDER" | "SIMPLE_PRODUCT_LIST";
  productSkus?: string[];
  blocks?: unknown[];
}) {
  return landingSnapshotSchema.parse({
    template: input.template ?? "BUILDER",
    title: "Back to school",
    lead: null,
    heroImageUrl: null,
    heroMobileImageUrl: null,
    heroImageAlt: null,
    heroCtaLabel: null,
    heroCtaHref: null,
    heroPictograms: {
      TOP_LEFT_1: null,
      TOP_LEFT_2: null,
      BOTTOM_RIGHT_1: null,
      BOTTOM_RIGHT_2: null,
    },
    blocks: input.blocks ?? [],
    productSkus: input.productSkus ?? [],
    seoTitle: null,
    seoDescription: null,
    ogImageUrl: null,
    canonicalUrl: null,
    robotsIndex: true,
    startsAt: null,
    endsAt: null,
  });
}

describe("database landing pages on the homepage", () => {
  it("round-trips the database landing-page identifier", () => {
    const key = databaseLandingPageKey("landing-page-id");
    expect(key).toBe("landing:landing-page-id");
    expect(databaseLandingPageId(key)).toBe("landing-page-id");
    expect(databaseLandingPageId("akcija")).toBeNull();
    expect(databaseLandingPageId("landing:")).toBeNull();
  });

  it("uses the simple landing page product order and removes duplicates", () => {
    const page = snapshot({
      template: "SIMPLE_PRODUCT_LIST",
      productSkus: ["SKU-2", "SKU-1", "SKU-2"],
    });
    expect(landingPageProductSkus(page)).toEqual(["SKU-2", "SKU-1"]);
  });

  it("collects products from visible builder grids only", () => {
    const page = snapshot({
      blocks: [
        {
          id: "products-1",
          type: "PRODUCT_GRID",
          visible: true,
          title: "Prvi red",
          body: null,
          productSkus: ["SKU-3", "SKU-1"],
        },
        {
          id: "products-hidden",
          type: "PRODUCT_GRID",
          visible: false,
          title: "Sakriveno",
          body: null,
          productSkus: ["SKU-HIDDEN"],
        },
        {
          id: "products-2",
          type: "PRODUCT_GRID",
          visible: true,
          title: "Drugi red",
          body: null,
          productSkus: ["SKU-1", "SKU-2"],
        },
      ],
    });
    expect(landingPageProductSkus(page)).toEqual(["SKU-3", "SKU-1", "SKU-2"]);
  });
});
