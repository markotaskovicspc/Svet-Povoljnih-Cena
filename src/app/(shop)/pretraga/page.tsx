import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProductCard } from "@/components/product/product-card";
import { searchProducts } from "@/lib/api/search";
import { getProductBySlug } from "@/lib/api/catalog";
import type { Product } from "@/types";
import type { SearchHit } from "@/types/search";

export const metadata: Metadata = {
  title: "Pretraga",
  description: "Rezultati pretrage proizvoda iz aktuelne ponude.",
};

interface SearchPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = (rawQuery ?? "").trim();
  const hits = query.length >= 3 ? await getHits(query) : [];
  const products = hits.length ? await getProductsFromHits(hits) : [];

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
              : `${products.length} ${products.length === 1 ? "rezultat" : "rezultata"}`}
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
        </section>
      </div>
    </main>
  );
}

async function getHits(query: string): Promise<SearchHit[]> {
  try {
    return await searchProducts(query, 72);
  } catch (error) {
    console.error("[pretraga]", error);
    return [];
  }
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
