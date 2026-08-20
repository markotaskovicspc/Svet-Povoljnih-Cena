import type { MetadataRoute } from "next";
import { db, hasDatabaseConnection } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { getCmsSitemapState } from "@/lib/cms/pages";
import { SYSTEM_CONTENT_SLUGS } from "@/lib/cms/system-pages";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";
import { getPublishedLandingPagesForSitemap } from "@/lib/storefront/landing-pages";

const STATIC_PATHS = [
  "", "/akcija", "/heroji-meseca", "/niske-cene-pod-zastitom",
  "/ogranicena-ponuda", "/novo", "/outlet", "/sve-do-999",
  "/specijalne-ponude", "/nedeljna-akcija", "/svet-akcija", "/o-nama",
  "/kontakt", "/pomoc", "/servis", "/reklamacije", "/komentari",
  "/uslovi-koriscenja", "/uslovi-isporuke", "/uslovi-kupovine",
  "/politika-privatnosti", "/brisanje-podataka", "/podesavanja-kolacica",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = BRAND.url.replace(/\/$/, "");
  const cmsSitemap = await getCmsSitemapState();
  const managedSlugs = cmsSitemap?.managedSlugs ?? new Set<string>();
  const publishedSlugs = new Set(
    cmsSitemap?.publishedPages.map((page) => page.slug) ?? [],
  );
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.filter((path) => {
    const slug = path.replace(/^\//, "");
    return (
      !SYSTEM_CONTENT_SLUGS.has(slug) ||
      !managedSlugs.has(slug) ||
      publishedSlugs.has(slug)
    );
  }).map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "" ? "daily" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
  entries.push(
    ...(cmsSitemap?.publishedPages ?? [])
      .filter((page) => !SYSTEM_CONTENT_SLUGS.has(page.slug))
      .map((page) => ({
        url: `${base}/${page.slug}`,
        lastModified: page.publishedAt,
        changeFrequency: "monthly" as const,
        priority: 0.6,
      })),
  );
  if (!hasDatabaseConnection()) return entries;
  try {
    const [products, categories, collections, landingPages] = await Promise.all([
      db.product.findMany({
        where: {
          ...webStorefrontProductWhere(),
          deletedAt: null,
          OR: [
            { familyMembership: { is: null } },
            { familyMembership: { is: { storefrontEnabled: true } } },
          ],
        },
        select: { slug: true, updatedAt: true },
      }),
      db.category.findMany({ select: { path: true, updatedAt: true } }),
      db.collection.findMany({ select: { slug: true } }),
      getPublishedLandingPagesForSitemap(),
    ]);
    entries.push(
      ...products.map((item) => ({ url: `${base}/p/${item.slug}`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
      ...categories.filter((item) => item.path).map((item) => ({ url: `${base}/k/${item.path.replace(/^\/+/, "")}`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
      ...collections.map((item) => ({ url: `${base}/kolekcija/${item.slug}`, changeFrequency: "weekly" as const, priority: 0.7 })),
      ...landingPages.map((item) => ({ url: `${base}/ponuda/${item.slug}`, lastModified: item.publishedAt, changeFrequency: "weekly" as const, priority: 0.75 })),
    );
  } catch {
    // A sitemap should remain available during a transient catalog outage.
  }
  return entries;
}
