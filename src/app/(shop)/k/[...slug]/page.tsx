import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingShell } from "@/components/listing/listing-shell";
import { getCategoryByPath, listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";
import type { Crumb } from "@/components/layout/breadcrumbs";

/**
 * Catch-all category listing.
 *
 * URL → categoryPath:
 *   /k/namestaj/police/otvorene
 *   matches a product whose categoryPath, slugified, starts with the URL segments.
 *
 * Resolves against the imported category table.
 */

async function resolveTrailAndTitle(slugSegments: string[]): Promise<{
  trail: Crumb[];
  title: string;
  subtitle?: string;
} | null> {
  const path = `/${slugSegments.map((s) => decodeURIComponent(s).toLowerCase()).join("/")}`;
  const category = await getCategoryByPath(path);
  if (!category) return null;

  const parts = category.path.split("/").filter(Boolean);
  const labels = category.name.split(" / ");
  const trail: Crumb[] = parts.map((part, i) => ({
    label: labels[i] ?? part,
    href: i < parts.length - 1 ? `/k/${parts.slice(0, i + 1).join("/")}` : undefined,
  }));
  return {
    trail,
    title: category.name,
    subtitle: category.description ?? undefined,
  };
}

interface RouteProps {
  params: Promise<{ slug: string[] }>;
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveTrailAndTitle(slug);
  if (!resolved) return { title: "Kategorija" };
  return {
    title: resolved.title,
    description: resolved.subtitle,
  };
}

export default async function CategoryPage({ params }: RouteProps) {
  const { slug } = await params;
  if (!slug?.length) notFound();
  const categoryPath = `/${slug.map((s) => decodeURIComponent(s).toLowerCase()).join("/")}`;
  const query = { categoryPath };
  const [resolved, { items: products, nextCursor, total }] = await Promise.all([
    resolveTrailAndTitle(slug),
    listProducts({ ...query, limit: LISTING_PAGE_SIZE }),
  ]);
  if (!resolved) notFound();

  return (
    <ListingShell
      kind="kategorija"
      title={resolved.title}
      subtitle={resolved.subtitle}
      trail={resolved.trail}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
