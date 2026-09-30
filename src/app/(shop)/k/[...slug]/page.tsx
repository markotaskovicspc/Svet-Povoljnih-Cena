import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ListingShell } from "@/components/listing/listing-shell";
import { getCategoryByPath, getCategoryBySlug, listProducts } from "@/lib/api/catalog";
import { LISTING_PAGE_SIZE } from "@/lib/listing/filters";
import type { Crumb } from "@/components/layout/breadcrumbs";
import { getTabTitleIcon } from "@/lib/storefront/content";
import { getSeoCatalog } from "@/lib/seo/catalog.server";
import { legacyCategoryPath, populatedCategoryPaths, productCategoryTrail, seoPlainText } from "@/lib/seo/catalog";

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
  path: string;
  canonical: string;
  isAlias: boolean;
  index?: boolean;
} | null> {
  const path = `/${slugSegments.map((s) => decodeURIComponent(s).toLowerCase()).join("/")}`;
  let category = await getCategoryByPath(path)
    ?? (slugSegments.length === 1 ? await getCategoryBySlug(path.slice(1)) : null);
  const catalog = await getSeoCatalog();
  if (!category && slugSegments.length === 1) {
    const legacyPath = legacyCategoryPath(path.slice(1), catalog?.categories ?? []);
    if (legacyPath) category = await getCategoryByPath(legacyPath);
  }
  if (!category) return null;
  const trail: Crumb[] = productCategoryTrail([category.path], catalog?.categories ?? []);
  if (trail.length) trail[trail.length - 1].href = undefined;
  return {
    trail,
    title: category.name,
    subtitle: category.description ?? undefined,
    path: category.path,
    canonical: `/k${category.path}`,
    isAlias: path !== category.path,
    index: catalog ? populatedCategoryPaths(catalog.products).has(category.path) : undefined,
  };
}

interface RouteProps {
  params: Promise<{ slug: string[] }>;
}

export const revalidate = 30;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveTrailAndTitle(slug);
  if (!resolved) return { title: "Kategorija", robots: { index: false, follow: true } };
  return {
    title: resolved.title,
    description: seoPlainText(resolved.subtitle) || `${resolved.title} u ponudi Sveta Povoljnih Cena. Uporedite modele, karakteristike i cene i proverite dostupnost i uslove isporuke.`,
    alternates: { canonical: resolved.canonical },
    ...(resolved.index === false ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function CategoryPage({ params }: RouteProps) {
  const { slug } = await params;
  if (!slug?.length) notFound();
  const resolved = await resolveTrailAndTitle(slug);
  if (!resolved) notFound();
  if (resolved.isAlias) permanentRedirect(resolved.canonical);
  const categoryPath = resolved.path;
  const query = { categoryPath };
  const [{ items: products, nextCursor, total }, titleIcon] = await Promise.all([
    listProducts({ ...query, limit: LISTING_PAGE_SIZE }),
    getTabTitleIcon(`/k${categoryPath}`),
  ]);

  return (
    <ListingShell
      kind="kategorija"
      title={resolved.title}
      titleIcon={titleIcon}
      subtitle={resolved.subtitle}
      trail={resolved.trail}
      source={products}
      initialNextCursor={nextCursor}
      total={total}
      pageQuery={query}
    />
  );
}
