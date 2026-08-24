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
    .normalize("NFD")
    .toLocaleLowerCase("sr-Latn-RS")
    .replace(/đ/g, "d")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function tokenizeSearchQuery(value: string) {
  return Array.from(
    new Set(
      value
        .trim()
        .normalize("NFD")
        .toLocaleLowerCase("sr-Latn-RS")
        .replace(/đ/g, "d")
        .replace(/\p{M}+/gu, "")
        .split(/[^\p{L}\p{N}]+/gu)
        .filter((token) => token.length >= 2 || /^\d$/.test(token)),
    ),
  );
}

export function searchTextMatchesTokens(query: string, values: string[]) {
  const queryTokens = tokenizeSearchQuery(query);
  if (!queryTokens.length) return false;
  const words = values.flatMap(tokenizeSearchQuery);

  return queryTokens.every((token) =>
    words.some(
      (word) =>
        word === token ||
        (token.length >= 3 && word.startsWith(token)),
    ),
  );
}

export function isCodeLikeSearchQuery(value: string) {
  return /^[a-z0-9_-]{2,8}$/i.test(value.trim()) && !value.includes(" ");
}

const SQL_DIACRITICS = "čćžšđ";
const SQL_ASCII = "cczsd";
const FUZZY_TOKEN_MIN_LENGTH = 5;
const FUZZY_SIMILARITY_THRESHOLD = 0.55;

function normalizedSqlText(value: Prisma.Sql) {
  return Prisma.sql`translate(lower(COALESCE(${value}, '')), ${SQL_DIACRITICS}, ${SQL_ASCII})`;
}

function normalizedSqlPhrase(value: Prisma.Sql) {
  return Prisma.sql`btrim(regexp_replace(${normalizedSqlText(value)}, '[^[:alnum:]]+', ' ', 'g'))`;
}

function wordMatchSql(
  value: Prisma.Sql,
  token: string,
  options: { fuzzy?: boolean; prefix?: boolean } = {},
) {
  const allowPrefix = options.prefix !== false && token.length >= 3;
  const allowFuzzy = options.fuzzy !== false && token.length >= FUZZY_TOKEN_MIN_LENGTH;

  return Prisma.sql`
    EXISTS (
      SELECT 1
        FROM unnest(
          regexp_split_to_array(${normalizedSqlText(value)}, '[^[:alnum:]]+')
        ) AS search_words(word)
       WHERE search_words.word = ${token}
          OR (${allowPrefix} AND search_words.word LIKE ${`${token}%`})
          OR (
            ${allowFuzzy}
            AND similarity(search_words.word, ${token}) >= ${FUZZY_SIMILARITY_THRESHOLD}
          )
    )
  `;
}

function identifierContainsSql(value: Prisma.Sql, token: string) {
  return Prisma.sql`${normalizedSqlText(value)} LIKE ${`%${token}%`}`;
}

function categoryTokenMatchSql(token: string, productAlias = "p") {
  const categoryName = Prisma.raw("search_category.name");
  return Prisma.sql`
    EXISTS (
      SELECT 1
        FROM "ProductCategory" search_pc
        JOIN "Category" search_category ON search_category.id = search_pc."categoryId"
       WHERE search_pc."productId" = ${Prisma.raw(`${productAlias}.id`)}
         AND ${wordMatchSql(categoryName, token)}
    )
  `;
}

function productTokenMatchSql(token: string) {
  return Prisma.sql`(
    ${wordMatchSql(Prisma.raw("p.name"), token)}
    OR ${wordMatchSql(Prisma.raw('p."sizeLabel"'), token)}
    OR ${identifierContainsSql(Prisma.raw("p.sku"), token)}
    OR ${identifierContainsSql(Prisma.raw("p.barcode"), token)}
    OR ${categoryTokenMatchSql(token)}
  )`;
}

function allTokenMatchesSql(
  tokens: string[],
  matcher: (token: string) => Prisma.Sql,
) {
  return Prisma.join(tokens.map(matcher), " AND ");
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
  const tokens = tokenizeSearchQuery(q);
  if (!tokens.length) return [];
  const normalizedPhrase = tokens.join(" ");
  const productTokenMatches = allTokenMatchesSql(tokens, productTokenMatchSql);
  const allExactNameTokens = allTokenMatchesSql(tokens, (token) =>
    wordMatchSql(Prisma.raw("p.name"), token, { fuzzy: false, prefix: false }),
  );
  const allPrefixNameTokens = allTokenMatchesSql(tokens, (token) =>
    wordMatchSql(Prisma.raw("p.name"), token, { fuzzy: false }),
  );
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
             (
               p."isHero"
               OR EXISTS (
                 SELECT 1
                   FROM "HeroOfMonth" hom
                  WHERE hom."productSku" = p.sku
                    AND hom.year = EXTRACT(
                      YEAR FROM (now() AT TIME ZONE 'Europe/Belgrade')
                    )::int
                    AND hom.month = EXTRACT(
                      MONTH FROM (now() AT TIME ZONE 'Europe/Belgrade')
                    )::int
               )
               OR EXISTS (
                 SELECT 1
                   FROM "Action" direct_action
                  WHERE direct_action.id = p."actionId"
                    AND direct_action.kind = 'HEROJI'
                    AND (
                      direct_action."isPermanent" = true
                      OR (
                        direct_action."startsAt" <= now()
                        AND direct_action."endsAt" >= now()
                      )
                    )
               )
               OR EXISTS (
                 SELECT 1
                   FROM "ActionProduct" action_product
                   JOIN "Action" priced_action
                     ON priced_action.id = action_product."actionId"
                  WHERE action_product."productId" = p.id
                    AND priced_action.kind = 'HEROJI'
                    AND (
                      priced_action."isPermanent" = true
                      OR (
                        priced_action."startsAt" <= now()
                        AND priced_action."endsAt" >= now()
                      )
                    )
               )
             ) AS is_hero,
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
         AND ${productTokenMatches}
       ORDER BY CASE
                  WHEN lower(p.sku) = lower(${q})
                    OR lower(COALESCE(p.barcode, '')) = lower(${q}) THEN 0
                  WHEN ${normalizedSqlPhrase(Prisma.raw("p.name"))} = ${normalizedPhrase} THEN 1
                  WHEN ${allExactNameTokens} THEN 2
                  WHEN ${allPrefixNameTokens} THEN 3
                  ELSE 4
                END ASC,
                is_hero DESC,
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
      isHero: Boolean(product.isHero),
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
  const tokens = tokenizeSearchQuery(query);
  if (!tokens.length) return [];
  const categoryName = Prisma.raw("search_nav.name");
  const exactTokenMatches = allTokenMatchesSql(tokens, (token) =>
    wordMatchSql(categoryName, token, { fuzzy: false, prefix: false }),
  );
  const prefixTokenMatches = allTokenMatchesSql(tokens, (token) =>
    wordMatchSql(categoryName, token, { fuzzy: false }),
  );
  const tokenMatches = allTokenMatchesSql(tokens, (token) =>
    wordMatchSql(categoryName, token),
  );
  const normalizedPhrase = tokens.join(" ");
  const categories = await db.$queryRaw<
    Array<{ id: string; name: string; path: string; level: number }>
  >(Prisma.sql`
    SELECT search_nav.id, search_nav.name, search_nav.path, search_nav.level
      FROM "Category" search_nav
     WHERE ${tokenMatches}
     ORDER BY CASE
                WHEN ${normalizedSqlPhrase(categoryName)} = ${normalizedPhrase} THEN 0
                WHEN ${exactTokenMatches} THEN 1
                WHEN ${prefixTokenMatches} THEN 2
                ELSE 3
              END ASC,
              search_nav.name ASC
     LIMIT 12
  `);

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
