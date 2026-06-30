import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProductCard } from "@/components/product/product-card";
import { searchProducts } from "@/lib/api/search";
import { getProductBySlug } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";
import type { Product } from "@/types";
import type { SearchHit } from "@/types/search";

export const metadata: Metadata = {
  title: "Pretraga",
  description: "Rezultati pretrage proizvoda iz aktuelne ponude.",
};

interface SearchPageProps {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const rawPage = Array.isArray(params.page) ? params.page[0] : params.page;
  const query = (rawQuery ?? "").trim();
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const offset = (page - 1) * LISTING_PAGE_SIZE;
  const hits = query.length >= 3 ? await getHits(query, offset) : [];
  const hasNextPage = hits.length > LISTING_PAGE_SIZE;
  const visibleHits = hasNextPage ? hits.slice(0, LISTING_PAGE_SIZE) : hits;
  const products = visibleHits.length ? await getProductsFromHits(visibleHits) : [];

  return (
    <main className="bg-canvas pb-24">
      <div className="mx-auto w-full max-w-[var(--container-page)] px-6 pt-6 md:pt-10">
        <Breadcrumbs trail={[{ label: "Pretraga" }]} className="mb-6" />

        <header className="border-border/60 border-b pb-6 md:pb-8">
          <h1 className="font-display text-2xl text-ink-900 md:text-5xl">
            {query ? `Rezultati za "${query}"` : "Pretraga"}
          </h1>
          <p className="mt-3 text-sm text-ink-500" aria-live="polite">
            {query.length < 3
              ? "Unesite najmanje 3 znaka za pretragu."
              : `${products.length} ${products.length === 1 ? "rezultat" : "rezultata"} na strani ${page}`}
          </p>
        </header>

        <section className="mt-6 md:mt-8">
          {query.length < 3 ? (
            <EmptyState title="Prekratak upit" text="Pretraga počinje od najmanje 3 znaka." />
          ) : products.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {products.map((product) => (
                <ProductCard key={product.sku} product={product} />
              ))}
            </div>
          ) : (
            <EmptyState title="Nema rezultata" text={`Nema proizvoda za "${query}".`} />
          )}
          {query.length >= 3 && (page > 1 || hasNextPage) ? (
            <nav
              aria-label="Strane pretrage"
              className="mt-8 flex items-center justify-center gap-3"
            >
              <Link
                href={searchPageHref(query, Math.max(1, page - 1))}
                aria-disabled={page <= 1}
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium text-ink-700 transition hover:border-walnut hover:text-walnut aria-disabled:pointer-events-none aria-disabled:opacity-45"
              >
                Prethodna
              </Link>
              <span className="text-sm text-ink-500">Strana {page}</span>
              <Link
                href={searchPageHref(query, page + 1)}
                aria-disabled={!hasNextPage}
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium text-ink-700 transition hover:border-walnut hover:text-walnut aria-disabled:pointer-events-none aria-disabled:opacity-45"
              >
                Sledeća
              </Link>
            </nav>
          ) : null}
        </section>
      </div>
    </main>
  );
}

async function getHits(query: string, offset: number): Promise<SearchHit[]> {
  try {
    return await searchProducts(query, LISTING_PAGE_SIZE + 1, offset);
  } catch (error) {
    console.error("[pretraga]", error);
    return [];
  }
}

function searchPageHref(query: string, page: number) {
  const params = new URLSearchParams({ q: query });
  if (page > 1) params.set("page", String(page));
  return `/pretraga?${params.toString()}`;
}

async function getProductsFromHits(hits: SearchHit[]) {
  const products = await Promise.all(hits.map((hit) => getProductBySlug(hit.slug)));
  return products.filter((product): product is Product => Boolean(product));
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-surface px-6 py-16 text-center ring-1 ring-border">
      <p className="font-display text-2xl text-ink-900">{title}</p>
      <p className="mt-2 text-sm text-ink-500">{text}</p>
    </div>
  );
}
