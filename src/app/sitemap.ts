import type { MetadataRoute } from "next";
import { db, hasDatabaseConnection } from "@/lib/db";
import { BRAND } from "@/lib/brand";

const STATIC_PATHS = [
  "", "/novo", "/outlet", "/sve-do-999", "/svet-akcija", "/o-nama",
  "/kontakt", "/pomoc", "/servis", "/reklamacije", "/komentari",
  "/uslovi-koriscenja", "/uslovi-isporuke", "/uslovi-kupovine",
  "/politika-privatnosti", "/brisanje-podataka", "/podesavanja-kolacica",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = BRAND.url.replace(/\/$/, "");
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "" ? "daily" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
  if (!hasDatabaseConnection()) return entries;
  try {
    const [products, categories, collections] = await Promise.all([
      db.product.findMany({ where: { isActive: true, deletedAt: null }, select: { slug: true, updatedAt: true } }),
      db.category.findMany({ select: { path: true, updatedAt: true } }),
      db.collection.findMany({ select: { slug: true } }),
    ]);
    entries.push(
      ...products.map((item) => ({ url: `${base}/p/${item.slug}`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
      ...categories.filter((item) => item.path).map((item) => ({ url: `${base}/k/${item.path.replace(/^\/+/, "")}`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 })),
      ...collections.map((item) => ({ url: `${base}/kolekcija/${item.slug}`, changeFrequency: "weekly" as const, priority: 0.7 })),
    );
  } catch {
    // A sitemap should remain available during a transient catalog outage.
  }
  return entries;
}
