import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, PackageSearch } from "lucide-react";
import {
  isMeaningfulSourceValue,
  primaryImage,
  productHref,
  sourceValue,
  svetAkcijaProducts,
} from "@/lib/svet-akcija/catalog";
import {
  getRelatedSvetAkcijaProducts,
  getSvetAkcijaProductBySku,
} from "@/lib/svet-akcija/db";

interface RouteProps {
  params: Promise<{ sifra: string }>;
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { sifra } = await params;
  const product = findStaticProduct(sifra);
  if (!product) return { title: "Proizvod" };
  return {
    title: `${sourceValue(product, "Kratki naziv")} — ${sourceValue(product, "Šifra")}`,
    description: sourceValue(product, "Opis"),
  };
}

export default async function SvetAkcijaProductPage({ params }: RouteProps) {
  const { sifra } = await params;
  await connection();
  const product = await getSvetAkcijaProductBySku(sifra);
  if (!product) notFound();

  const image = primaryImage(product);
  const gallery = product.media?.images ?? [];
  const related = await getRelatedSvetAkcijaProducts(product);

  return (
    <main className="bg-canvas">
      <div className="mx-auto w-full max-w-[var(--container-page)] px-4 py-6 md:px-6 md:py-10">
        <Link
          href="/svet-akcija"
          className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-brand-blue transition hover:text-brand-blue-700"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Nazad na katalog
        </Link>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <section
            aria-label="Galerija proizvoda"
            className="overflow-hidden rounded-md border border-border bg-white"
          >
            <div className="relative flex aspect-[4/3] items-center justify-center bg-muted-bg text-ink-300">
              {image ? (
                <Image
                  src={image.url}
                  alt={image.alt ?? sourceValue(product, "Kratki naziv")}
                  fill
                  priority
                  sizes="(min-width: 1024px) 48vw, 100vw"
                  className="object-contain p-4"
                />
              ) : (
                <>
                  <PackageSearch className="size-20" aria-hidden />
                  <span className="sr-only">Slika nije uneta u izvorni katalog</span>
                </>
              )}
            </div>
            {gallery.length > 1 ? (
              <div className="grid grid-cols-4 gap-2 p-2 sm:grid-cols-5">
                {gallery.slice(0, 10).map((item, index) => (
                  <div
                    key={`${item.url}-${index}`}
                    className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted-bg"
                  >
                    <Image
                      src={item.url}
                      alt={item.alt ?? `${sourceValue(product, "Kratki naziv")} ${index + 1}`}
                      fill
                      sizes="96px"
                      className="object-contain p-1.5"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <div className="flex flex-wrap gap-2">
              <Badge>{sourceValue(product, "Kategorija")}</Badge>
              <Badge>{sourceValue(product, "Grupa")}</Badge>
            </div>
            <h1 className="font-display mt-4 text-3xl text-ink-900 md:text-5xl">
              {sourceValue(product, "Kratki naziv")}
            </h1>
            <p className="mt-4 text-base leading-7 text-ink-700">
              {sourceValue(product, "Opis")}
            </p>

            <div className="mt-6 rounded-md border border-border bg-white p-4">
              <p className="text-xs font-semibold tracking-[0.14em] text-action uppercase">
                Akcijska MPC
              </p>
              <p className="mt-1 text-4xl font-bold text-action">
                {sourceValue(product, "Akcijska MPC")} RSD
              </p>
              {isMeaningfulSourceValue(sourceValue(product, "MPC redovna")) ? (
                <p className="mt-1 text-sm text-ink-500">
                  MPC redovna: {sourceValue(product, "MPC redovna")} RSD
                </p>
              ) : null}
              <p className="mt-3 text-xs text-ink-500">
                Važenje akcijske cene: {sourceValue(product, "Važenje akcijske cene od")} -{" "}
                {sourceValue(product, "Važenje akcijske cene do")}
              </p>
            </div>

            <div className="mt-6">
              <h2 className="text-lg font-semibold text-ink-900">Specifikacije</h2>
              <dl className="mt-3 divide-y divide-border rounded-md border border-border bg-white">
                <SpecRow label="Šifra" value={sourceValue(product, "Šifra")} />
                <SpecRow label="Kategorija" value={sourceValue(product, "Kategorija")} />
                <SpecRow label="Grupa" value={sourceValue(product, "Grupa")} />
                <SpecRow label="Kolekcija (brend)" value={sourceValue(product, "Kolekcija (brend)")} />
                <SpecRow label="Atribut 1" value={sourceValue(product, "Atribut 1")} />
                <SpecRow label="Atribut 2" value={sourceValue(product, "Atribut 2")} />
                <SpecRow label="Boja 1" value={sourceValue(product, "Boja 1")} />
                <SpecRow label="Boja 2" value={sourceValue(product, "Boja 2")} />
                <SpecRow label="Dobavljač" value={sourceValue(product, "Dobavljač")} />
                <SpecRow label="Bar kod" value={sourceValue(product, "Bar kod")} />
              </dl>
            </div>

            <div className="mt-6 rounded-md border border-dashed border-border bg-muted-bg/60 p-4">
              <p className="text-sm font-semibold text-ink-900">Dugi opis</p>
              {product.longDescription ? (
                <div className="mt-3 whitespace-pre-line text-sm leading-6 text-ink-700">
                  {product.longDescription}
                </div>
              ) : (
                <p className="mt-1 text-sm text-ink-500">
                  Dugi opis nije unet za šifru {sourceValue(product, "Šifra")}.
                </p>
              )}
            </div>
          </section>
        </div>

        {related.length ? (
          <section className="mt-12 border-t border-border pt-8">
            <h2 className="font-display text-2xl text-ink-900">Slični proizvodi</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((item) => (
                <Link
                  key={sourceValue(item, "Šifra")}
                  href={productHref(item)}
                  className="rounded-md border border-border bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-soft-2"
                >
                  <p className="text-sm font-semibold text-ink-900">
                    {sourceValue(item, "Kratki naziv")}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-ink-500">
                    {sourceValue(item, "Opis")}
                  </p>
                  <p className="mt-3 text-sm font-bold text-action">
                    {sourceValue(item, "Akcijska MPC")} RSD
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function findStaticProduct(sifra: string) {
  const decoded = decodeURIComponent(sifra);
  return svetAkcijaProducts.find((product) => sourceValue(product, "Šifra") === decoded);
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-md bg-brand-blue-50 px-2.5 py-1 text-xs font-medium text-brand-blue">
      {children}
    </span>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  if (!isMeaningfulSourceValue(value)) return null;
  return (
    <div className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[180px_1fr]">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium text-ink-900">{value}</dd>
    </div>
  );
}
