import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { suggest } from "@/lib/api/search";
import { formatRsd } from "@/lib/format";
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

  return (
    <main className="bg-canvas pb-24">
      <div className="mx-auto w-full max-w-[var(--container-page)] px-6 pt-6 md:pt-10">
        <Breadcrumbs trail={[{ label: "Pretraga" }]} className="mb-6" />

        <header className="border-border/60 border-b pb-6 md:pb-8">
          <p className="font-mono text-[11px] tracking-[0.2em] text-walnut uppercase md:text-xs">
            Pretraga proizvoda
          </p>
          <h1 className="font-display mt-1.5 text-2xl text-ink-900 md:mt-2 md:text-5xl">
            {query ? `Rezultati za "${query}"` : "Pretraga"}
          </h1>
          <p className="mt-3 text-sm text-ink-500" aria-live="polite">
            {query.length < 3
              ? "Unesite najmanje 3 znaka za pretragu."
              : `${hits.length} ${hits.length === 1 ? "rezultat" : "rezultata"}`}
          </p>
        </header>

        <section className="mt-6 md:mt-8">
          {query.length < 3 ? (
            <EmptyState title="Prekratak upit" text="Pretraga počinje od najmanje 3 znaka." />
          ) : hits.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {hits.map((hit) => (
                <SearchResultCard key={hit.sku} hit={hit} />
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
    return await suggest(query, 48);
  } catch (error) {
    console.error("[pretraga]", error);
    return [];
  }
}

function SearchResultCard({ hit }: { hit: SearchHit }) {
  return (
    <Link
      href={`/p/${hit.slug}`}
      className="group overflow-hidden rounded-lg bg-white ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-soft-3 hover:ring-walnut/30 focus-visible:ring-2 focus-visible:ring-walnut/40 focus-visible:outline-none"
    >
      <div className="relative aspect-[4/3] bg-white">
        {hit.thumbnailUrl ? (
          <Image
            src={hit.thumbnailUrl}
            alt={hit.name}
            fill
            sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-contain p-3 transition duration-300"
          />
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate font-mono text-[11px] text-ink-500">
          {hit.breadcrumb || hit.sku}
        </p>
        <h2 className="line-clamp-2 min-h-10 text-sm font-semibold text-ink-900">
          {hit.name}
        </h2>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-action">
              {formatRsd(hit.salePrice)}
            </p>
          </div>
          <ArrowRight className="size-4 shrink-0 text-walnut transition group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg bg-surface px-6 py-16 text-center ring-1 ring-border">
      <p className="font-display text-2xl text-ink-900">{title}</p>
      <p className="mt-2 text-sm text-ink-500">{text}</p>
    </div>
  );
}
