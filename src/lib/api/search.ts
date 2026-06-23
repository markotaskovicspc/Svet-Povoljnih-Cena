import "server-only";
import { Prisma } from "@prisma/client";
import { db, hasDatabaseConnection } from "@/lib/db";
import { num } from "@/lib/api/_helpers";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import type { SearchHit } from "@/types/search";

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
  slug: string;
  name: string;
  full_price: Prisma.Decimal;
  sale_price: Prisma.Decimal | null;
  discount_pct: number | null;
  is_hero: boolean;
  thumbnail: string | null;
  breadcrumb: string | null;
}

const MIN_QUERY_LEN = 3;

export async function suggest(query: string, limit = 8): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY_LEN) return [];
  const safeLimit = Math.min(Math.max(limit, 1), 96);
  if (!hasDatabaseConnection()) return [];

  let rows: SuggestRow[] = [];
  try {
    // pg_trgm-based fuzzy match on name + sku, with category/group matching
    // so "peg" and "pegle" find products filed under the Pegle category.
    rows = await db.$queryRaw<SuggestRow[]>`
      SELECT p.sku,
             p.slug,
             p.name,
             p."fullPrice"   AS full_price,
             p."salePrice"   AS sale_price,
             p."discountPct" AS discount_pct,
             p."isHero"      AS is_hero,
             (SELECT pm.url FROM "ProductMedia" pm
                WHERE pm."productId" = p.id AND pm.kind = 'IMAGE'
                ORDER BY pm."order" ASC LIMIT 1) AS thumbnail,
             (SELECT string_agg(c.name, ' / ' ORDER BY c.level ASC)
                FROM "ProductCategory" pc
                JOIN "Category" c ON c.id = pc."categoryId"
               WHERE pc."productId" = p.id) AS breadcrumb
        FROM "Product" p
       WHERE p."isActive" = true
         AND (p.name ILIKE ${'%' + q + '%'} OR p.sku ILIKE ${'%' + q + '%'}
              OR p.barcode ILIKE ${'%' + q + '%'}
              OR similarity(p.name, ${q}) > 0.2
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
              ))
       ORDER BY CASE
                  WHEN p.name ILIKE ${q + '%'} THEN 0
                  WHEN EXISTS (
                    SELECT 1
                      FROM "ProductCategory" pc3
                      JOIN "Category" c3 ON c3.id = pc3."categoryId"
                     WHERE pc3."productId" = p.id
                       AND c3.name ILIKE ${'%' + q + '%'}
                  ) THEN 1
                  ELSE 2
                END ASC,
                p."isHero" DESC,
                COALESCE(p."discountPct", 0) DESC,
                COALESCE(p."salePrice", p."fullPrice") ASC
       LIMIT ${safeLimit}
    `;
  } catch (err) {
    console.warn("[search] Real catalog search is unavailable.", err);
    return [];
  }

  return rows.map((r) => ({
    sku: r.sku,
    slug: r.slug,
    name: r.name,
    breadcrumb: r.breadcrumb ?? "",
    thumbnailUrl: resolveSupabaseStorageUrl(r.thumbnail),
    fullPrice: num(r.full_price),
    salePrice: r.sale_price ? num(r.sale_price) : num(r.full_price),
    discountPct: r.discount_pct ?? 0,
    isHero: r.is_hero,
  }));
}

export async function searchProducts(query: string, limit = 48): Promise<SearchHit[]> {
  return suggest(query, Math.min(Math.max(limit, 1), 120));
}
