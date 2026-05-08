import "server-only";

/**
 * Phase 4G — Google Merchant + Meta Catalog feeds.
 *
 * Centralised configuration for the auto-generated product feeds and
 * the per-channel ad budgets. Provider HTTP push (Google Ads /
 * Meta Marketing API) is intentionally out of scope for v1: the v1
 * deliverable is the public feed URL plus the admin checkbox + budget
 * input. v1.1 will add the upload jobs.
 */

export interface FeedsConfig {
  /** Public canonical base URL — used to build product links + image URLs. */
  baseUrl: string;
  /** Shop name surfaced in the GMC `<title>` element. */
  shopTitle: string;
  /** GMC `<description>` element. */
  shopDescription: string;
  /** ISO 4217 currency code for prices (Serbia → RSD). */
  currency: string;
  /** GMC `<g:google_product_category>` fallback (numeric or text). */
  defaultGoogleCategory: string;
  /** Default brand emitted when a product has no explicit brand set. */
  defaultBrand: string;
  /** GMC content language (BCP-47-ish — sr is what GMC accepts for Serbia). */
  contentLanguage: string;
  /** Target country for the feed (ISO 3166-1 alpha-2). */
  targetCountry: string;
  /** Hard cap on items emitted per request (safety net for very large catalogs). */
  maxItems: number;
}

let cached: FeedsConfig | null = null;

export function getFeedsConfig(): FeedsConfig {
  if (cached) return cached;
  cached = {
    baseUrl: (
      process.env.NEXT_PUBLIC_BASE_URL ??
      process.env.NEXTAUTH_URL ??
      "https://www.svetpovoljnihcena.rs"
    ).replace(/\/$/, ""),
    shopTitle: process.env.FEEDS_SHOP_TITLE ?? "Svet Povoljnih Cena",
    shopDescription:
      process.env.FEEDS_SHOP_DESCRIPTION ??
      "Nameštaj, beli tehnika i kućni asortiman po povoljnim cenama.",
    currency: process.env.FEEDS_CURRENCY ?? "RSD",
    defaultGoogleCategory:
      process.env.FEEDS_GOOGLE_CATEGORY ?? "Furniture",
    defaultBrand: process.env.FEEDS_DEFAULT_BRAND ?? "Svet Povoljnih Cena",
    contentLanguage: process.env.FEEDS_LANGUAGE ?? "sr",
    targetCountry: process.env.FEEDS_COUNTRY ?? "RS",
    maxItems: Number(process.env.FEEDS_MAX_ITEMS ?? 50_000),
  };
  return cached;
}

/** Test-only helper. */
export function __resetFeedsConfig() {
  cached = null;
}
