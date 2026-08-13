import { describe, expect, it } from "vitest";
import {
  EMPTY_HERO_PICTOGRAMS,
  landingBlocksSchema,
  landingSnapshotSchema,
  legacySectionsToBlocks,
  newLandingBlock,
  parseLandingBlocks,
  validateLandingBlocksForPublish,
  type LandingBlock,
} from "@/lib/landing-pages/blocks";

describe("landing page blocks", () => {
  it("accepts every supported block type", () => {
    const blocks = [
      newLandingBlock("RICH_TEXT"),
      newLandingBlock("BANNER"),
      newLandingBlock("PRODUCT_GRID"),
      newLandingBlock("PICTOGRAM_ROW"),
      newLandingBlock("CTA"),
    ];
    expect(landingBlocksSchema.safeParse(blocks).success).toBe(true);
  });

  it("rejects unsafe image and CTA URLs", () => {
    const banner = {
      ...newLandingBlock("BANNER"),
      imageDesktopUrl: "javascript:alert(1)",
      ctaLabel: "Klik",
      ctaHref: "//evil.example/path",
    };
    expect(landingBlocksSchema.safeParse([banner]).success).toBe(false);
    expect(parseLandingBlocks([banner])).toEqual([]);
  });

  it("blocks publish for H1/raw HTML and incomplete content blocks", () => {
    const blocks: LandingBlock[] = [
      {
        id: "text-1",
        type: "RICH_TEXT",
        visible: true,
        title: null,
        bodyMarkdown: "# Nedozvoljen H1\n\n<script>alert(1)</script>",
      },
      {
        id: "products-1",
        type: "PRODUCT_GRID",
        visible: true,
        title: "Proizvodi",
        body: null,
        productSkus: [],
      },
    ];
    const issues = validateLandingBlocksForPublish(blocks).join(" ");
    expect(issues).toContain("Koristite ## ili ###");
    expect(issues).toContain("Sirov HTML");
    expect(issues).toContain("nema izabrane artikle");
  });

  it("does not publish validation errors from hidden blocks", () => {
    const block = newLandingBlock("PRODUCT_GRID");
    expect(validateLandingBlocksForPublish([{ ...block, visible: false }])).toEqual([]);
  });

  it("converts legacy sections without losing image, text or SKU order", () => {
    const blocks = legacySectionsToBlocks([{
      id: "section-1",
      title: "Letnja ponuda",
      body: "Tekst ponude",
      imageUrl: "/images/summer.jpg",
      productSkus: ["SKU-2", "SKU-1"],
    }]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "BANNER", title: "Letnja ponuda", imageDesktopUrl: "/images/summer.jpg" });
    expect(blocks[1]).toMatchObject({ type: "PRODUCT_GRID", productSkus: ["SKU-2", "SKU-1"] });
  });

  it("normalizes a revision snapshot and defaults the legacy flag", () => {
    const parsed = landingSnapshotSchema.parse({
      title: "Test strana",
      lead: null,
      heroImageUrl: null,
      heroMobileImageUrl: null,
      heroImageAlt: null,
      heroCtaLabel: null,
      heroCtaHref: null,
      heroPictograms: EMPTY_HERO_PICTOGRAMS,
      blocks: [],
      seoTitle: null,
      seoDescription: null,
      ogImageUrl: null,
      canonicalUrl: "/ponuda/test-strana",
      robotsIndex: true,
      startsAt: null,
      endsAt: null,
    });
    expect(parsed.template).toBe("BUILDER");
    expect(parsed.productSkus).toEqual([]);
    expect(parsed.legacySectionsFallback).toBe(false);
    expect(parsed.canonicalUrl).toBe("/ponuda/test-strana");
  });

  it("accepts an unbounded manual product list for the simple template", () => {
    const productSkus = Array.from({ length: 1_250 }, (_, index) => `SKU-${index + 1}`);
    const parsed = landingSnapshotSchema.parse({
      template: "SIMPLE_PRODUCT_LIST",
      title: "Velika ponuda",
      lead: null,
      heroImageUrl: "/images/hero.jpg",
      heroMobileImageUrl: null,
      heroImageAlt: "Velika ponuda",
      heroCtaLabel: "Pogledajte proizvode",
      heroCtaHref: "#proizvodi",
      heroPictograms: EMPTY_HERO_PICTOGRAMS,
      blocks: [],
      productSkus,
      seoTitle: null,
      seoDescription: null,
      ogImageUrl: null,
      canonicalUrl: null,
      robotsIndex: true,
      startsAt: null,
      endsAt: null,
    });
    expect(parsed.productSkus).toHaveLength(1_250);
    expect(parsed.productSkus.at(-1)).toBe("SKU-1250");
  });
});
