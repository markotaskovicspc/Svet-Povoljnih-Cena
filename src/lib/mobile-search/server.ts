import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import type { Product } from "@/types";
import type { SearchHit } from "@/types/search";
import type { MobileSearchContent } from "@/types/mobile-search";
import { db, hasDatabaseConnection } from "@/lib/db";
import { getCategoryTree, getProductCardsBySlugs, listProductRail } from "@/lib/api/catalog";
import { getMediaVariantUrl } from "@/lib/media";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { resolveProductPriceQuote } from "@/lib/pricing";
import { landingPageIsLive, resolveMobileTabHref } from "@/lib/mobile-shortcuts/server";
import {
  DEFAULT_MOBILE_SEARCH_QUERIES,
  fallbackCurrentItems,
  MOBILE_SEARCH_CONFIG_KEY,
  orderedAvailableProducts,
  mobileSearchDestinationWindowIsLive,
} from "@/lib/mobile-search/shared";

function productSearchHit(product: Product): SearchHit {
  const quote = resolveProductPriceQuote(product, { loggedIn: false });
  const image = product.media.images[0];
  return {
    type: "product",
    href: `/p/${product.slug}`,
    sku: product.sku,
    slug: product.slug,
    name: product.name,
    breadcrumb: product.categoryPath.join(" / "),
    thumbnailUrl: resolveSupabaseStorageUrl(getMediaVariantUrl(image, "thumb")),
    fullPrice: quote.full,
    actionPrice: quote.actionOffer?.effective,
    loyaltyPrice: quote.loyaltyOffer?.effective,
    salePrice: quote.actionOffer?.effective ?? quote.full,
    discountPct: quote.actionOffer?.discountPct ?? 0,
    isHero: Boolean(product.isHero),
  };
}

async function fallbackMobileSearchContent(): Promise<MobileSearchContent> {
  const [categories, products] = await Promise.all([
    getCategoryTree(),
    listProductRail({ limit: 4 }),
  ]);
  return {
    currentItems: fallbackCurrentItems(categories),
    popularProducts: products.items.slice(0, 4).map(productSearchHit),
    frequentQueries: [...DEFAULT_MOBILE_SEARCH_QUERIES],
    defaultViewAllHref: "/akcija",
  };
}

function isMissingSchemaError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "P2021" ||
      (error as { code?: string }).code === "P2022")
  );
}

async function loadMobileSearchContent(): Promise<MobileSearchContent> {
  if (!hasDatabaseConnection()) return fallbackMobileSearchContent();
  try {
    // A freshly checked-out branch can briefly run against an older generated
    // Prisma client before `db:generate` executes. Treat that exactly like a
    // database that has not received this optional CMS migration yet.
    const configStore = db.mobileSearchConfig;
    if (!configStore) return fallbackMobileSearchContent();
    const config = await configStore.findUnique({
      where: { key: MOBILE_SEARCH_CONFIG_KEY },
      include: {
        currentItems: {
          where: { enabled: true },
          orderBy: { position: "asc" },
          include: {
            action: { select: { slug: true, kind: true, startsAt: true, endsAt: true } },
            landingPage: {
              select: { slug: true, status: true, startsAt: true, endsAt: true },
            },
          },
        },
        products: {
          orderBy: { position: "asc" },
          include: { product: { select: { slug: true } } },
        },
      },
    });
    if (!config) return fallbackMobileSearchContent();

    const products = await getProductCardsBySlugs(
      config.products.map((entry) => entry.product.slug),
      { throwOnError: true },
    );
    const now = new Date();
    return {
      currentItems: config.currentItems.flatMap((item) => {
        if (
          (item.action && !mobileSearchDestinationWindowIsLive(item.action, now)) ||
          (item.landingPage && !landingPageIsLive(item.landingPage))
        ) {
          return [];
        }
        const href = resolveMobileTabHref(item);
        return href
          ? [{ id: item.id, label: item.label, href, imageUrl: item.imageUrl }]
          : [];
      }),
      popularProducts: orderedAvailableProducts(
        config.products.map((entry) => entry.product.slug),
        products,
      ).map(productSearchHit),
      frequentQueries: config.frequentQueries,
      defaultViewAllHref: config.viewAllHref,
    };
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      console.error("[mobile-search] Failed to load CMS configuration.", error);
    }
    return fallbackMobileSearchContent();
  }
}

const getMobileSearchContentAcrossRequests = unstable_cache(
  loadMobileSearchContent,
  ["storefront-mobile-search-v1"],
  { revalidate: 60, tags: ["storefront-mobile-search", "catalog-products", "storefront-categories"] },
);

export const getMobileSearchContent = cache(getMobileSearchContentAcrossRequests);
