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
import { resolveMobileTabDestination } from "@/lib/mobile-shortcuts/server";
import {
  DEFAULT_MOBILE_SEARCH_QUERIES,
  fallbackCurrentItems,
  MOBILE_SEARCH_SETTING_KEY,
  parseMobileSearchStoredConfig,
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

async function loadMobileSearchContent(): Promise<MobileSearchContent> {
  if (!hasDatabaseConnection()) return fallbackMobileSearchContent();
  try {
    const setting = await db.adminSetting.findUnique({
      where: { key: MOBILE_SEARCH_SETTING_KEY },
      select: { value: true },
    });
    const config = parseMobileSearchStoredConfig(setting?.value);
    if (!config) return fallbackMobileSearchContent();

    const selectedProducts = await db.product.findMany({
      where: { sku: { in: config.productSkus } },
      select: { sku: true, slug: true },
    });
    const slugBySku = new Map(
      selectedProducts.map((product) => [product.sku, product.slug]),
    );
    const products = await getProductCardsBySlugs(
      config.productSkus.flatMap((sku) => {
        const slug = slugBySku.get(sku);
        return slug ? [slug] : [];
      }),
      { throwOnError: true },
    );
    const productsBySku = new Map(products.map((product) => [product.sku, product]));
    const currentItems = await Promise.all(
      config.currentItems.map(async (item) => {
        try {
          const destination = await resolveMobileTabDestination({
            selection: item.destination,
            customHref: item.customHref,
            enabled: true,
          });
          return {
            id: `mobile-search-current-${item.position}`,
            label: item.label,
            href: destination.href,
            imageUrl: item.imageUrl,
          };
        } catch {
          return null;
        }
      }),
    );
    let defaultViewAllHref = "/akcija";
    try {
      defaultViewAllHref = (
        await resolveMobileTabDestination({
          selection: config.viewAllDestination,
          customHref: config.viewAllCustomHref,
          enabled: true,
        })
      ).href;
    } catch {
      // Keep the stable action fallback if an action or landing destination expires.
    }
    return {
      currentItems: currentItems.filter((item) => item !== null),
      popularProducts: config.productSkus.flatMap((sku) => {
        const product = productsBySku.get(sku);
        return product ? [productSearchHit(product)] : [];
      }),
      frequentQueries: config.frequentQueries,
      defaultViewAllHref,
    };
  } catch (error) {
    console.error("[mobile-search] Failed to load CMS configuration.", error);
    return fallbackMobileSearchContent();
  }
}

const getMobileSearchContentAcrossRequests = unstable_cache(
  loadMobileSearchContent,
  ["storefront-mobile-search-v1"],
  { revalidate: 60, tags: ["storefront-mobile-search", "catalog-products", "storefront-categories"] },
);

export const getMobileSearchContent = cache(getMobileSearchContentAcrossRequests);
