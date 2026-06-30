import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingShell } from "@/components/listing/listing-shell";
import { getCollectionBySlug, listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";

interface RouteProps {
  params: Promise<{ slug: string }>;
}

function normalizeSlug(slug: string) {
  return decodeURIComponent(slug).toLowerCase();
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const collection = await getCollectionBySlug(normalizeSlug(slug));
  if (!collection) return { title: "Kolekcija" };

  return {
    title: `${collection.name} kolekcija`,
    description: `Svi proizvodi iz kolekcije ${collection.name}.`,
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
