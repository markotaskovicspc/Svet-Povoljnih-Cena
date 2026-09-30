import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingShell } from "@/components/listing/listing-shell";
import { getCollectionBySlug, listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";
import { getSeoCatalog } from "@/lib/seo/catalog.server";

interface RouteProps {
  params: Promise<{ slug: string }>;
}

export const revalidate = 30;

export function generateStaticParams() {
  return [];
}

function normalizeSlug(slug: string) {
  return decodeURIComponent(slug).toLowerCase();
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollectionBySlug(normalizeSlug(slug));
  if (!collection) return { title: "Kolekcija" };
  const catalog = await getSeoCatalog();
  const collectionId = catalog?.collections.find(c => c.slug === collection.slug)?.id;
  const hasProducts = catalog?.products.some(p => p.collectionId === collectionId);

  return {
    title: `${collection.name} kolekcija`,
    description: `${collection.name} u ponudi Sveta Povoljnih Cena. Pogledajte modele, dostupne varijante, cene i informacije o isporuci.`,
    alternates: { canonical: `/kolekcija/${collection.slug}` },
    ...(hasProducts === false ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CollectionPage({ params }: RouteProps) {
  const { slug } = await params;
  const collectionSlug = normalizeSlug(slug);
  const query = { collectionSlug };
  const [collection, { items: products, nextCursor, total }] = await Promise.all([
    getCollectionBySlug(collectionSlug),
    listProducts({ ...query, limit: LISTING_PAGE_SIZE }),
  ]);

  if (!collection) notFound();

  return (
    <ListingShell
      kind="kolekcija"
      title={collection.name}
      subtitle={`Svi proizvodi iz kolekcije ${collection.name}.`}
      trail={[{ label: "Kolekcije" }, { label: collection.name }]}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
