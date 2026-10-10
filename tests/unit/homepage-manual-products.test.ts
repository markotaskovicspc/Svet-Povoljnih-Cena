import { beforeEach, describe, expect, it, vi } from "vitest";
import { landingSnapshotSchema } from "@/lib/landing-pages/blocks";
import type { Product } from "@/types";

const mocks = vi.hoisted(() => ({
  slots: vi.fn(),
  page: vi.fn(),
  products: vi.fn(),
  listProducts: vi.fn(),
  category: vi.fn(),
}));

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/db", () => ({
  hasDatabaseConnection: () => true,
  db: {
    homeSectionSlot: { findMany: mocks.slots },
    category: { findUnique: mocks.category },
  },
}));
vi.mock("@/lib/storefront/homepage-schema", () => ({
  hasHomeSectionSlotTable: async () => true,
  hasBannerPlacementColumn: async () => false,
  hasTabPictogramColumn: async () => false,
}));
vi.mock("@/lib/storefront/landing-pages", () => ({
  getLandingPageForStorefrontById: mocks.page,
}));
vi.mock("@/lib/api/catalog", () => ({
  getProductsBySkus: mocks.products,
  listProducts: mocks.listProducts,
}));

import { getHomeLayout } from "@/lib/storefront/homepage";

const skus = ["110006", "110003", "110018", "110015", "110017"];
const families = ["travel-mate", "travel-mate", "adventure-set", "travel-mate-set", "adventure-set"];
const products = skus.map((sku, index) => ({
  sku,
  variantFamily: { id: families[index], selectedSku: sku },
})) as Product[];

function slots(productLimit = 12, landingPageKey = "landing:koferi") {
  return ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH"].map((slotKey) => ({
    slotKey,
    sourceType: "LANDING_PAGE",
    landingPageKey,
    titleOverride: null,
    productLimit,
    enabled: slotKey === "FIRST",
    action: null,
  }));
}

function page(template: "BUILDER" | "SIMPLE_PRODUCT_LIST" = "SIMPLE_PRODUCT_LIST") {
  return {
    id: "koferi",
    slug: "koferi",
    snapshot: landingSnapshotSchema.parse({
      template,
      title: "Koferi",
      lead: null,
      heroImageUrl: null,
      heroMobileImageUrl: null,
      heroImageAlt: null,
      heroCtaLabel: null,
      heroCtaHref: null,
      blocks: template === "BUILDER" ? [{
        id: "koferi-products",
        type: "PRODUCT_GRID",
        visible: true,
        title: null,
        body: null,
        productSkus: skus,
      }] : [],
      productSkus: template === "SIMPLE_PRODUCT_LIST" ? skus : [],
      seoTitle: null,
      seoDescription: null,
      ogImageUrl: null,
      canonicalUrl: null,
      robotsIndex: true,
      startsAt: null,
      endsAt: null,
    }),
  };
}

beforeEach(() => {
  mocks.slots.mockResolvedValue(slots());
  mocks.page.mockResolvedValue(page());
  mocks.products.mockResolvedValue(products);
  mocks.listProducts.mockResolvedValue({ items: products, nextCursor: null });
  mocks.category.mockResolvedValue({ name: "Koferi", path: "/putovanje/koferi" });
});

describe("hamburger category pages on the homepage", () => {
  it("resolves the current category path and requests the configured SKU limit", async () => {
    mocks.slots.mockResolvedValue(slots(2, "category:koferi-id"));
    mocks.listProducts.mockResolvedValue({ items: products.slice(0, 2), nextCursor: "next" });

    const layout = await getHomeLayout();

    expect(mocks.category).toHaveBeenCalledWith({
      where: { id: "koferi-id" }, select: { name: true, path: true },
    });
    expect(mocks.listProducts).toHaveBeenCalledWith(expect.objectContaining({
      categoryPath: "/putovanje/koferi", limit: 2, includeTotal: false,
    }));
    expect(layout.sections.FIRST).toMatchObject({ title: "Koferi", href: "/k/putovanje/koferi" });
    expect(layout.sections.FIRST?.products.map((product) => product.sku)).toEqual(["110006", "110003"]);
    expect(mocks.listProducts).toHaveBeenCalledTimes(1);
    expect(mocks.page).not.toHaveBeenCalled();
  });

  it("keeps all category SKUs even when several belong to the same family", async () => {
    mocks.slots.mockResolvedValue(slots(12, "category:koferi-id"));

    const layout = await getHomeLayout();

    expect(layout.sections.FIRST?.products.map((product) => product.sku)).toEqual(skus);
    expect(mocks.page).not.toHaveBeenCalled();
    expect(mocks.products).not.toHaveBeenCalled();
  });

  it("keeps an empty category section and its custom title", async () => {
    const configured = slots(12, "category:koferi-id");
    mocks.slots.mockResolvedValue(configured.map((slot) => ({ ...slot, titleOverride: "Za putovanja" })));
    mocks.listProducts.mockResolvedValue({ items: [], nextCursor: null });

    expect((await getHomeLayout()).sections.FIRST).toMatchObject({
      title: "Za putovanja", href: "/k/putovanje/koferi", products: [],
    });
  });

  it("omits a deleted category without querying an unfiltered catalog", async () => {
    mocks.slots.mockResolvedValue(slots(12, "category:deleted"));
    mocks.category.mockResolvedValue(null);

    expect((await getHomeLayout()).sections.FIRST).toBeUndefined();
    expect(mocks.listProducts).not.toHaveBeenCalled();
  });
});

describe("manual landing products on the homepage", () => {
  it.each(["SIMPLE_PRODUCT_LIST", "BUILDER"] as const)(
    "keeps five explicitly selected SKUs from three families for %s",
    async (template) => {
      mocks.page.mockResolvedValue(page(template));

      const layout = await getHomeLayout();

      expect(mocks.products).toHaveBeenCalledWith(skus);
      expect(layout.sections.FIRST?.products.map((product) => product.sku)).toEqual(skus);
      expect(layout.sections.FIRST?.href).toBe("/ponuda/koferi");
    },
  );

  it("applies the configured product limit after preserving the selected SKU order", async () => {
    mocks.slots.mockResolvedValue(slots(4));

    const layout = await getHomeLayout();

    expect(layout.sections.FIRST?.products.map((product) => product.sku)).toEqual(skus.slice(0, 4));
  });

  it("continues grouping automatic catalog rails by family", async () => {
    mocks.slots.mockResolvedValue(slots(12, "akcija"));

    const layout = await getHomeLayout();

    expect(layout.sections.FIRST?.products.map((product) => product.sku)).toEqual(["110006", "110018", "110015"]);
    expect(mocks.products).not.toHaveBeenCalled();
  });
});
