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
  const safeLimit = Math.min(Math.max(limit, 1), 20);
  if (!hasDatabaseConnection()) return [];

  let rows: SuggestRow[] = [];
  try {
    // pg_trgm-based fuzzy match on name + sku, with category breadcrumb joined.
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
              OR similarity(p.name, ${q}) > 0.25)
       ORDER BY p."isHero" DESC,
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
