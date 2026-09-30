import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db, hasDatabaseConnection } from "@/lib/db";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";

async function loadSeoCatalog() {
  if (!hasDatabaseConnection()) return null;
  // An outage must throw, not cache an empty catalog and noindex real inventory.
  const [products, categories, collections] = await Promise.all([
    db.product.findMany({
      where: { AND: [webStorefrontProductWhere(), {
        OR: [
          { familyMembership: { is: null } },
          { familyMembership: { is: { storefrontEnabled: true } } }],
      }] },
      select: { sku: true, slug: true, updatedAt: true, collectionId: true,
        categories: { select: { category: { select: { path: true } } } } },
    }),
    db.category.findMany({ select: { slug: true, path: true, name: true, updatedAt: true } }),
    db.collection.findMany({ select: { id: true, slug: true } }),
  ]);
  return { products, categories, collections };
}

export const getSeoCatalog = cache(unstable_cache(loadSeoCatalog,
  ["storefront-seo-catalog-v1"], { revalidate: 60, tags: ["storefront-categories", "storefront-products"] }));
