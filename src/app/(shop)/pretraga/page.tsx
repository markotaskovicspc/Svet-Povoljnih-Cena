import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ListingShell } from "@/components/listing/listing-shell";
import { listSearchProducts } from "@/lib/api/search-listing";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";
import { logOperationalError } from "@/lib/monitoring";

export const metadata: Metadata = {
  title: "Pretraga",
  description: "Rezultati pretrage proizvoda iz aktuelne ponude.",
  robots: { index: false, follow: true },
};

interface SearchPageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = (Array.isArray(params.q) ? params.q[0] ?? "" : params.q ?? "").trim();
  const title = query ? `Rezultati za "${query}"` : "Pretraga";
  let unavailable = false;
  let result: Awaited<ReturnType<typeof listSearchProducts>> | undefined;
  if (query.length >= 3) {
    try {
      result = await listSearchProducts(query, { limit: LISTING_PAGE_SIZE });
    } catch (error) {
      unavailable = true;
      logOperationalError("storefront.search_page.failed", error, { queryLength: query.length });
    }
  }
  if (result?.items.length) return <ListingShell
    kind="pretraga" title={title} trail={[{ label: "Pretraga" }]}
    source={result.items} total={result.total} initialNextCursor={result.nextCursor}
    pageQuery={{ searchQuery: query }}
  />;
  return <div className="bg-canvas pb-24">
    <div className="mx-auto w-full max-w-[var(--container-page)] px-6 pt-6 md:pt-10">
      <Breadcrumbs trail={[{ label: "Pretraga" }]} className="mb-6" />
      <h1 className="mb-6 font-display text-2xl text-ink-900 md:text-5xl">{title}</h1>
      <div className="rounded-lg bg-surface px-6 py-16 text-center ring-1 ring-border">
        <p className="font-display text-2xl text-ink-900">{query.length < 3
          ? "Prekratak upit" : unavailable ? "Pretraga trenutno nije dostupna" : "Nema rezultata"}</p>
        <p className="mt-2 text-sm text-ink-500">{query.length < 3
          ? "Unesite najmanje 3 znaka za pretragu." : unavailable
            ? "Došlo je do privremenog problema. Pokušajte ponovo za nekoliko trenutaka."
            : `Nema proizvoda za "${query}".`}</p>
        {unavailable ? <Link href={`/pretraga?${new URLSearchParams({ q: query })}`}
          className="mt-5 inline-flex h-10 items-center rounded-md border border-walnut px-4 text-sm font-semibold text-walnut">
          Pokušaj ponovo
        </Link> : null}
      </div>
    </div>
  </div>;
}
