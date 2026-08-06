import "server-only";
import { Prisma } from "@prisma/client";
import { db, hasDatabaseConnection } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { getMediaVariantUrl } from "@/lib/media";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { getProductCardsBySlugs } from "@/lib/api/catalog";
import { resolveProductPriceQuote } from "@/lib/pricing";
import type {
  SearchHit,
  SearchNavigationHit,
  SearchSuggestion,
} from "@/types/search";
import { isWebAutoAvailabilityEnforced } from "@/lib/web-storefront-availability";

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
  family_id: string | null;
  is_family_primary: boolean;
  slug: string;
  name: string;
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

export class SearchUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SearchUnavailableError";
  }
}

export function selectSearchFamilyRepresentatives<
  T extends Pick<SuggestRow, "sku" | "family_id" | "is_family_primary">,
>(rows: T[]) {
  const familyRepresentatives = new Map<string, T>();
  for (const row of rows) {
    const key = row.family_id ? `family:${row.family_id}` : `sku:${row.sku}`;
    const current = familyRepresentatives.get(key);
    if (!current || (!current.is_family_primary && row.is_family_primary)) {
      familyRepresentatives.set(key, row);
    }
  }
  return [...familyRepresentatives.values()];
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
  const codeLike = /^[A-Z0-9_-]{2,8}$/.test(q) && !q.includes(" ");
  const enforceAutoAvailability = isWebAutoAvailabilityEnforced();
  if (!hasDatabaseConnection()) {
    throw new SearchUnavailableError("Database connection string is not configured.");
  }

  let rows: SuggestRow[] = [];
  try {
    rows = await db.$queryRaw<SuggestRow[]>`
      SELECT p.sku,
             p.barcode,
             pfm."familyId" AS family_id,
             COALESCE(pf."primaryProductId" = p.id, false) AS is_family_primary,
             p.slug,
             p.name,
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
        LEFT JOIN "ProductFamily" pf ON pf.id = pfm."familyId"
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
             OR p.sku ILIKE ${'%' + q + '%'}
             OR p.barcode ILIKE ${'%' + q + '%'}
           ))
           OR (${!codeLike} AND (
             p.name ILIKE ${'%' + q + '%'}
             OR p.sku ILIKE ${'%' + q + '%'}
             OR p.barcode ILIKE ${'%' + q + '%'}
             OR EXISTS (
               SELECT 1
                 FROM "ProductCategory" pc2
                 JOIN "Category" c2 ON c2.id = pc2."categoryId"
                WHERE pc2."productId" = p.id
                  AND c2.name ILIKE ${'%' + q + '%'}
             )
             OR EXISTS (
               SELECT 1
                 FROM "Group" g
                WHERE g.id = p."groupId"
                  AND g.name ILIKE ${'%' + q + '%'}
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
    rows = selectSearchFamilyRepresentatives(rows)
      .slice(safeOffset, safeOffset + safeLimit);
  }

  const products = await getProductCardsBySlugs(rows.map((row) => row.slug));
  const productsBySlug = new Map(products.map((product) => [product.slug, product]));

  return rows.map((r) => {
    const product = productsBySlug.get(r.slug);
    const fullPrice = product?.fullPrice ?? num(r.full_price);
    const quote = resolveProductPriceQuote(
      product ?? {
        fullPrice,
        salePrice: r.sale_price ? num(r.sale_price) : null,
        discountPct: r.discount_pct,
      },
      { loggedIn: false },
    );
    return {
      type: "product" as const,
      href: `/p/${r.slug}`,
      sku: r.sku,
      slug: r.slug,
      name: r.name,
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
    };
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
  const [categories, groups] = await Promise.all([
    db.category.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true, path: true, level: true },
      take: 12,
    }),
    db.group.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true, slug: true },
      take: 12,
    }),
  ]);

  return [
    ...categories.map((category) => ({
      type: "category" as const,
      id: category.id,
      name: category.name,
      href: `/k${category.path.startsWith("/") ? category.path : `/${category.path}`}`,
      breadcrumb: category.level > 0 ? "Kategorija" : "Glavna kategorija",
    })),
    ...groups.map((group) => ({
      type: "group" as const,
      id: group.id,
      name: group.name,
      href: `/pretraga?q=${encodeURIComponent(group.name)}`,
      breadcrumb: "Grupa proizvoda",
    })),
  ]
    .sort(
      (left, right) =>
        navigationRank(left.name, query) - navigationRank(right.name, query) ||
        (left.type === right.type ? 0 : left.type === "category" ? -1 : 1) ||
        left.name.localeCompare(right.name, "sr"),
    )
    .slice(0, 6);
}

export async function suggest(query: string, limit = 8): Promise<SearchSuggestion[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LEN) return [];
  if (!hasDatabaseConnection()) {
    throw new SearchUnavailableError("Database connection string is not configured.");
  }
  const [navigation, products] = await Promise.all([
    searchNavigationHits(q),
    searchProductHits(q, limit),
  ]);
  return [...navigation, ...products];
}

export async function searchProducts(
  query: string,
  limit = 48,
  offset = 0,
): Promise<SearchHit[]> {
  return searchProductHits(query, Math.min(Math.max(limit, 1), 120), offset);
}
