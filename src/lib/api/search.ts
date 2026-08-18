import "server-only";
import { Prisma } from "@prisma/client";
import { db, hasDatabaseConnection } from "@/lib/db";
import { getMediaVariantUrl } from "@/lib/media";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { getProductCardsBySlugs } from "@/lib/api/catalog";
import { resolveProductPriceQuote } from "@/lib/pricing";
import { logOperationalError } from "@/lib/monitoring";
import type {
  SearchHit,
  SearchNavigationHit,
  SearchSuggestion,
} from "@/types/search";
import { isWebAutoAvailabilityEnforced } from "@/lib/web-storefront-availability";
import { formatProductDisplayName } from "@/lib/product-name";

/**
 * Search layer (Phase 3C — item 8).
 *
 * Uses Postgres trigram similarity (`pg_trgm` extension declared in
 * `schema.prisma`) for the instant-search suggest endpoint. Sort order matches
 * spec section 3 (Header instant-search):
 *   1) Heroji meseca first, 2) najveći popust, 3) najniža cena.
 *
 * Meilisearch is a future drop-in (Phase 4 if FTS proves insufficient).
 */

interface SuggestRow {
  sku: string;
  barcode: string | null;
  slug: string;
  name: string;
  size_label: string | null;
  full_price: Prisma.Decimal;
  sale_price: Prisma.Decimal | null;
  discount_pct: number | null;
  is_hero: boolean;
  thumbnail: string | null;
  thumbnail_thumb: string | null;
  thumbnail_card: string | null;
  breadcrumb: string | null;
}

const MIN_QUERY_LEN = 3;
const NAVIGATION_SUGGEST_TIMEOUT_MS = 1_500;
const PRODUCT_SUGGEST_TIMEOUT_MS = 6_000;
const FULL_SEARCH_TIMEOUT_MS = 10_000;

export interface SearchSuggestionResult {
  hits: SearchSuggestion[];
  degraded: boolean;
}

export class SearchUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

function withSearchTimeout<T>(promise: Promise<T>, timeoutMs: number, source: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new SearchUnavailableError(`${source} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

export function mergeSearchSuggestionSources(
  navigation: PromiseSettledResult<SearchNavigationHit[]>,
  products: PromiseSettledResult<SearchHit[]>,
): SearchSuggestionResult {
  if (products.status === "rejected") {
    throw new SearchUnavailableError(
      "Product suggestions are unavailable.",
      products.reason,
    );
  }

  return {
    hits: [
      ...(navigation.status === "fulfilled" ? navigation.value : []),
      ...products.value,
    ],
    degraded: navigation.status === "rejected",
  };
}

export function paginateSearchSkuRows<T>(rows: T[], offset: number, limit: number) {
  return rows.slice(offset, offset + limit);
}

export function normalizeSearchTerm(value: string) {
  return value
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("sr-Latn-RS")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function isCodeLikeSearchQuery(value: string) {
  return /^[a-z0-9_-]{2,8}$/i.test(value.trim()) && !value.includes(" ");
}

async function searchProductHits(
  query: string,
  limit = 8,
  offset = 0,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LEN) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 96);
  const safeOffset = Math.max(0, Math.round(offset));
  const queryLimit = Math.min(1000, Math.max(safeLimit + safeOffset, safeLimit) * 4);
  const codeLike = isCodeLikeSearchQuery(q);
  const normalizedTerm = normalizeSearchTerm(q);
  const enforceAutoAvailability = isWebAutoAvailabilityEnforced();
  if (!hasDatabaseConnection()) {
    throw new SearchUnavailableError("Database connection string is not configured.");
  }

  let rows: SuggestRow[] = [];
  try {
    rows = await db.$queryRaw<SuggestRow[]>`
      SELECT p.sku,
             p.barcode,
             p.slug,
             p.name,
             p."sizeLabel"  AS size_label,
             p."fullPrice"   AS full_price,
             p."salePrice"   AS sale_price,
             p."discountPct" AS discount_pct,
             p."isHero"      AS is_hero,
             (SELECT pm.url FROM "ProductMedia" pm
                WHERE pm."productId" = p.id AND pm.kind = 'IMAGE'
                ORDER BY pm."order" ASC LIMIT 1) AS thumbnail,
             (SELECT pm."thumbUrl" FROM "ProductMedia" pm
                WHERE pm."productId" = p.id AND pm.kind = 'IMAGE'
                ORDER BY pm."order" ASC LIMIT 1) AS thumbnail_thumb,
             (SELECT pm."cardUrl" FROM "ProductMedia" pm
                WHERE pm."productId" = p.id AND pm.kind = 'IMAGE'
                ORDER BY pm."order" ASC LIMIT 1) AS thumbnail_card,
             (SELECT string_agg(c.name, ' / ' ORDER BY c.level ASC)
                FROM "ProductCategory" pc
                JOIN "Category" c ON c.id = pc."categoryId"
               WHERE pc."productId" = p.id) AS breadcrumb
        FROM "Product" p
        LEFT JOIN "ProductFamilyMember" pfm ON pfm."productId" = p.id
       WHERE p."isActive" = true
         AND p."availableWebManual" = true
         AND (${!enforceAutoAvailability} OR p."availableWebAuto" = true)
         AND (pfm.id IS NULL OR pfm."storefrontEnabled" = true)
         AND EXISTS (
           SELECT 1
             FROM "PriceListEntry" ple
             JOIN "PriceList" pl ON pl.id = ple."priceListId"
            WHERE ple."productId" = p.id
              AND ple.price > 0
              AND ple."validFrom" <= now()
              AND (ple."validTo" IS NULL OR ple."validTo" >= now())
              AND pl.kind = 'RETAIL'
              AND pl.active = true
         )
         AND (
           (${codeLike} AND (
             lower(${q}) = ANY (
               regexp_split_to_array(lower(p.name), '[^[:alnum:]_-]+')
             )
             OR regexp_replace(lower(p.name), '[^[:alnum:]]+', '', 'g')
                  LIKE ${'%' + normalizedTerm + '%'}
             OR p.sku ILIKE ${'%' + q + '%'}
             OR p.barcode ILIKE ${'%' + q + '%'}
           ))
           OR (${!codeLike} AND (
             p.name ILIKE ${'%' + q + '%'}
             OR p."sizeLabel" ILIKE ${'%' + q + '%'}
             OR p.sku ILIKE ${'%' + q + '%'}
             OR p.barcode ILIKE ${'%' + q + '%'}
             OR EXISTS (
               SELECT 1
                 FROM "ProductCategory" pc2
                 JOIN "Category" c2 ON c2.id = pc2."categoryId"
                WHERE pc2."productId" = p.id
                  AND c2.name ILIKE ${'%' + q + '%'}
             )
           ))
         )
       ORDER BY CASE
                  WHEN lower(p.name) = lower(${q}) THEN 0
                  WHEN lower(p.sku) = lower(${q}) OR lower(COALESCE(p.barcode, '')) = lower(${q}) THEN 1
                  WHEN ${codeLike} AND lower(${q}) = ANY (
                    regexp_split_to_array(lower(p.name), '[^[:alnum:]_-]+')
                  ) THEN 2
                  WHEN p.name ILIKE ${q + '%'} THEN 2
                  WHEN p.name ILIKE ${'%' + q + '%'} THEN 3
                  WHEN p.sku ILIKE ${'%' + q + '%'} OR p.barcode ILIKE ${'%' + q + '%'} THEN 4
                  WHEN EXISTS (
                    SELECT 1
                      FROM "ProductCategory" pc3
                      JOIN "Category" c3 ON c3.id = pc3."categoryId"
                     WHERE pc3."productId" = p.id
                       AND c3.name ILIKE ${'%' + q + '%'}
                  ) THEN 5
                  ELSE 6
                END ASC,
                p."isHero" DESC,
                COALESCE(p."discountPct", 0) DESC,
                COALESCE(p."salePrice", p."fullPrice") ASC
       LIMIT ${queryLimit}
    `;
  } catch (err) {
    throw new SearchUnavailableError("Real catalog search is unavailable.", err);
  }

  const normalizedQuery = q.toLocaleLowerCase("sr-Latn-RS");
  const exactIdentifier = rows.find(
    (row) =>
      row.sku.trim().toLocaleLowerCase("sr-Latn-RS") === normalizedQuery ||
      row.barcode?.trim().toLocaleLowerCase("sr-Latn-RS") === normalizedQuery,
  );
  if (exactIdentifier) rows = [exactIdentifier];
  const exactNameRows = rows.filter(
    (row) => row.name.trim().toLocaleLowerCase("sr-Latn-RS") === normalizedQuery,
  );
  if (exactNameRows.length) rows = exactNameRows;
  if (!exactIdentifier) {
    rows = paginateSearchSkuRows(rows, safeOffset, safeLimit);
  }

  const products = await getProductCardsBySlugs(
    rows.map((row) => row.slug),
    { throwOnError: true },
  );
  const productsBySlug = new Map(products.map((product) => [product.slug, product]));

  return rows.flatMap((r) => {
    const product = productsBySlug.get(r.slug);
    // The batch loader is the authoritative storefront-availability gate.
    // Raw SQL candidates that fail it (including below-threshold/stale Rabalux stock)
    // must not leak through the suggestion fallback.
    if (!product) return [];
    const quote = resolveProductPriceQuote(product, { loggedIn: false });
    return [{
      type: "product" as const,
      href: `/p/${r.slug}`,
      sku: r.sku,
      slug: r.slug,
      name:
        product.name ?? formatProductDisplayName(r.name, r.size_label),
      breadcrumb: r.breadcrumb ?? "",
      thumbnailUrl: resolveSupabaseStorageUrl(
        getMediaVariantUrl(
          {
            url: r.thumbnail,
            thumbUrl: r.thumbnail_thumb,
            cardUrl: r.thumbnail_card,
          },
          "thumb",
        ),
      ),
      fullPrice: quote.full,
      actionPrice: quote.actionOffer?.effective,
      loyaltyPrice: quote.loyaltyOffer?.effective,
      salePrice: quote.actionOffer?.effective ?? quote.full,
      discountPct: quote.actionOffer?.discountPct ?? 0,
      isHero: r.is_hero,
    }];
  });
}

function navigationRank(name: string, query: string) {
  const normalizedName = name.trim().toLocaleLowerCase("sr-Latn-RS");
  const normalizedQuery = query.trim().toLocaleLowerCase("sr-Latn-RS");
  if (normalizedName === normalizedQuery) return 0;
  if (normalizedName.startsWith(normalizedQuery)) return 1;
  return 2;
}

async function searchNavigationHits(query: string): Promise<SearchNavigationHit[]> {
  const categories = await db.category.findMany({
    where: { name: { contains: query, mode: "insensitive" } },
    select: { id: true, name: true, path: true, level: true },
    take: 12,
  });

  return categories
    .map((category) => ({
      type: "category" as const,
      id: category.id,
      name: category.name,
      href: `/k${category.path.startsWith("/") ? category.path : `/${category.path}`}`,
      breadcrumb: category.level > 0 ? "Kategorija" : "Glavna kategorija",
    }))
    .sort(
      (left, right) =>
        navigationRank(left.name, query) - navigationRank(right.name, query) ||
        left.name.localeCompare(right.name, "sr"),
    )
    .slice(0, 6);
}

export async function suggest(
  query: string,
  limit = 8,
): Promise<SearchSuggestionResult> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LEN) return { hits: [], degraded: false };
  if (!hasDatabaseConnection()) {
    throw new SearchUnavailableError("Database connection string is not configured.");
  }
  const [navigation, products] = await Promise.allSettled([
    withSearchTimeout(
      searchNavigationHits(q),
      NAVIGATION_SUGGEST_TIMEOUT_MS,
      "Navigation suggestions",
    ),
    withSearchTimeout(
      searchProductHits(q, limit),
      PRODUCT_SUGGEST_TIMEOUT_MS,
      "Product suggestions",
    ),
  ]);
  const result = mergeSearchSuggestionSources(navigation, products);
  if (navigation.status === "rejected") {
    logOperationalError("search.suggest.navigation_degraded", navigation.reason, {
      queryLength: q.length,
    });
  }
  return result;
}

export async function searchProducts(
  query: string,
  limit = 48,
  offset = 0,
): Promise<SearchHit[]> {
  return withSearchTimeout(
    searchProductHits(query, Math.min(Math.max(limit, 1), 120), offset),
    FULL_SEARCH_TIMEOUT_MS,
    "Product search",
  );
}
