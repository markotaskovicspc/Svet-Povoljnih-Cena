"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  PackageSearch,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  isMeaningfulSourceValue,
  parseSourcePrice,
  primaryImage,
  productHref,
  sourceValue,
  type SvetAkcijaProduct,
} from "@/lib/svet-akcija/catalog";

type SortKey = "source" | "price-asc" | "price-desc" | "category";

interface CatalogProps {
  products: SvetAkcijaProduct[];
}

export function SvetAkcijaCatalog({ products }: CatalogProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [group, setGroup] = useState("all");
  const [brand, setBrand] = useState("all");
  const [color, setColor] = useState("all");
  const [sort, setSort] = useState<SortKey>("source");

  const facets = useMemo(() => buildFacets(products), [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("sr-Latn-RS");
    const searched = products.filter((product) => {
      if (category !== "all" && sourceValue(product, "Kategorija") !== category) return false;
      if (group !== "all" && sourceValue(product, "Grupa") !== group) return false;
      if (brand !== "all" && sourceValue(product, "Kolekcija (brend)") !== brand) return false;
      if (
        color !== "all" &&
        sourceValue(product, "Boja 1") !== color &&
        sourceValue(product, "Boja 2") !== color
      ) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        "Šifra",
        "Kratki naziv",
        "Opis",
        "Kategorija",
        "Grupa",
        "Bar kod",
        "Kolekcija (brend)",
      ]
        .map((field) => sourceValue(product, field as keyof SvetAkcijaProduct["source"]))
        .join(" ")
        .toLocaleLowerCase("sr-Latn-RS");
      return haystack.includes(q);
    });

    return searched
      .map((product, index) => ({ product, index }))
      .sort((a, b) => {
        if (sort === "price-asc" || sort === "price-desc") {
          const left = parseSourcePrice(sourceValue(a.product, "Akcijska MPC")) ?? Infinity;
          const right = parseSourcePrice(sourceValue(b.product, "Akcijska MPC")) ?? Infinity;
          return sort === "price-asc" ? left - right : right - left;
        }
        if (sort === "category") {
          return (
            sourceValue(a.product, "Kategorija").localeCompare(
              sourceValue(b.product, "Kategorija"),
              "sr-Latn-RS",
            ) ||
            sourceValue(a.product, "Grupa").localeCompare(
              sourceValue(b.product, "Grupa"),
              "sr-Latn-RS",
            ) ||
            a.index - b.index
          );
        }
        return a.index - b.index;
      })
      .map(({ product }) => product);
  }, [brand, category, color, group, products, query, sort]);

  const groupsForCategory = useMemo(() => {
    if (category === "all") return facets.groups;
    return facets.groups.filter((item) =>
      products.some(
        (product) =>
          sourceValue(product, "Kategorija") === category &&
          sourceValue(product, "Grupa") === item.value,
      ),
    );
  }, [category, facets.groups, products]);

  const hasActiveFilters =
    query || category !== "all" || group !== "all" || brand !== "all" || color !== "all";

  function resetFilters() {
    setQuery("");
    setCategory("all");
    setGroup("all");
    setBrand("all");
    setColor("all");
    setSort("source");
  }

  return (
    <main className="bg-canvas">
      <div className="mx-auto w-full max-w-[var(--container-page)] px-4 py-6 md:px-6 md:py-10">
        <div className="mb-5 flex flex-col gap-4 border-b border-border pb-5 md:mb-7 md:flex-row md:items-end md:justify-between md:pb-7">
          <div className="max-w-3xl">
            <h1 className="font-display text-3xl text-ink-900 md:text-5xl">
              Proizvodi iz uvoznog fajla
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink-700 md:text-base">
              {products.length} artikala iz izvornog kataloga. Nazivi, opisi, šifre i cene
              prikazani su iz tabele bez prepravki.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center md:min-w-[330px]">
            <Stat label="Artikala" value={products.length} />
            <Stat label="Kategorije" value={facets.categories.length} />
            <Stat label="Grupe" value={facets.groups.length} />
          </div>
        </div>

        <section
          aria-label="Pretraga i filteri kataloga"
          className="mb-6 grid gap-3 border-b border-border pb-5 lg:grid-cols-[minmax(260px,1.5fr)_repeat(5,minmax(150px,1fr))_auto]"
        >
          <label className="relative block">
            <span className="sr-only">Pretraga</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-300"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pretraga po šifri, nazivu, opisu, barkodu..."
              className="h-11 w-full rounded-md border border-border bg-white pr-3 pl-10 text-sm text-ink-900 outline-none transition placeholder:text-ink-300 focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            />
          </label>
          <FacetSelect
            label="Kategorija"
            value={category}
            onChange={(value) => {
              setCategory(value);
              setGroup("all");
            }}
            options={facets.categories}
          />
          <FacetSelect
            label="Grupa"
            value={group}
            onChange={setGroup}
            options={groupsForCategory}
          />
          <FacetSelect
            label="Brend"
            value={brand}
            onChange={setBrand}
            options={facets.brands}
          />
          <FacetSelect
            label="Boja"
            value={color}
            onChange={setColor}
            options={facets.colors}
          />
          <label className="block">
            <span className="sr-only">Sortiranje</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm text-ink-900 outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
            >
              <option value="source">Redosled iz fajla</option>
              <option value="price-asc">Cena rastuće</option>
              <option value="price-desc">Cena opadajuće</option>
              <option value="category">Kategorija</option>
            </select>
          </label>
          <button
            type="button"
            onClick={resetFilters}
            disabled={!hasActiveFilters && sort === "source"}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-ink-700 transition hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-45"
          >
            <X className="size-4" aria-hidden />
            Reset
          </button>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-500" aria-live="polite">
            Prikazano {filtered.length} od {products.length}
          </p>
          <div className="inline-flex items-center gap-2 rounded-md bg-brand-blue-50 px-3 py-2 text-xs text-brand-blue">
            <SlidersHorizontal className="size-4" aria-hidden />
            Filteri ne prikazuju prazne ni placeholder vrednosti.
          </div>
        </div>

        {filtered.length ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((product) => (
              <CatalogCard key={sourceValue(product, "Šifra")} product={product} />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-white px-6 py-16 text-center">
            <p className="font-display text-2xl text-ink-900">Nema proizvoda za izabrane filtere</p>
            <button
              type="button"
              onClick={resetFilters}
              className="mt-5 inline-flex rounded-md bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-blue-700"
            >
              Resetuj filtere
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

function CatalogCard({ product }: { product: SvetAkcijaProduct }) {
  const salePrice = sourceValue(product, "Akcijska MPC");
  const regularPrice = sourceValue(product, "MPC redovna");
  const brand = sourceValue(product, "Kolekcija (brend)");
  const primaryColor = sourceValue(product, "Boja 1");
  const secondaryColor = sourceValue(product, "Boja 2");
  const image = primaryImage(product);

  return (
    <article className="group flex min-h-full flex-col overflow-hidden rounded-md border border-border bg-white shadow-soft-1 transition hover:-translate-y-0.5 hover:shadow-soft-3">
      <Link
        href={productHref(product)}
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-white text-ink-300 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
        aria-label={`${sourceValue(product, "Kratki naziv")} detalji`}
      >
        {image ? (
          <Image
            src={image.url}
            alt={image.alt ?? sourceValue(product, "Kratki naziv")}
            fill
            sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-contain p-4 transition duration-300"
          />
        ) : (
          <>
            <PackageSearch className="size-12" aria-hidden />
            <span className="sr-only">Slika nije uneta u izvorni katalog</span>
          </>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{sourceValue(product, "Kategorija")}</Badge>
          <Badge>{sourceValue(product, "Grupa")}</Badge>
        </div>
        <div className="min-w-0">
          <h2 className="line-clamp-2 text-base font-semibold text-ink-900">
            <Link href={productHref(product)} className="hover:text-brand-blue">
              {sourceValue(product, "Kratki naziv")}
            </Link>
          </h2>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-ink-700">
            {sourceValue(product, "Opis")}
          </p>
        </div>
        <div className="mt-auto">
          <p className="text-xs font-medium text-action">Akcijska MPC</p>
          <p className="text-2xl font-bold text-action">{salePrice} RSD</p>
          {isMeaningfulSourceValue(regularPrice) ? (
            <p className="mt-0.5 text-xs text-ink-500">MPC redovna: {regularPrice} RSD</p>
          ) : null}
        </div>
        <dl className="grid gap-1.5 text-xs text-ink-700">
          <SpecLine label="Šifra" value={sourceValue(product, "Šifra")} />
          {isMeaningfulSourceValue(brand) ? <SpecLine label="Brend" value={brand} /> : null}
          {isMeaningfulSourceValue(primaryColor) ? (
            <SpecLine label="Boja" value={[primaryColor, secondaryColor].filter(isMeaningfulSourceValue).join(" / ")} />
          ) : null}
        </dl>
        <Link
          href={productHref(product)}
          className="mt-1 inline-flex h-10 items-center justify-center rounded-md bg-brand-blue px-4 text-sm font-semibold text-white transition hover:bg-brand-blue-700 focus-visible:ring-2 focus-visible:ring-brand-blue/35 focus-visible:outline-none"
        >
          Detaljnije
        </Link>
      </div>
    </article>
  );
}

function FacetSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; count: number }[];
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm text-ink-900 outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/15"
      >
        <option value="all">{label}: sve</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} ({option.count})
          </option>
        ))}
      </select>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-white px-3 py-2">
      <p className="text-lg font-bold text-brand-blue">{value}</p>
      <p className="text-[11px] text-ink-500">{label}</p>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-md bg-brand-blue-50 px-2 py-1 text-[11px] font-medium text-brand-blue">
      {children}
    </span>
  );
}

function SpecLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function buildFacets(products: SvetAkcijaProduct[]) {
  return {
    categories: countValues(products, ["Kategorija"]),
    groups: countValues(products, ["Grupa"]),
    brands: countValues(products, ["Kolekcija (brend)"]),
    colors: countValues(products, ["Boja 1", "Boja 2"]),
  };
}

function countValues(products: SvetAkcijaProduct[], fields: (keyof SvetAkcijaProduct["source"])[]) {
  const counts = new Map<string, number>();
  for (const product of products) {
    for (const field of fields) {
      const value = product.source[field];
      if (!isMeaningfulSourceValue(value)) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) =>
    a.value.localeCompare(b.value, "sr-Latn-RS"),
  );
}
