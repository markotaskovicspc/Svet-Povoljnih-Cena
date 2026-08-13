import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";

export type LandingAdminProduct = {
  sku: string;
  name: string;
  slug: string;
  imageUrl: string;
  availableForWeb: boolean;
  exists: boolean;
};

const QUERY_BATCH_SIZE = 500;

/** Mirrors the catalog-card visibility rule, including enabled family members. */
export function landingStorefrontProductWhere(): Prisma.ProductWhereInput {
  return {
    AND: [
      webStorefrontProductWhere(),
      {
        OR: [
          { familyMembership: { is: null } },
          { familyMembership: { is: { storefrontEnabled: true } } },
        ],
      },
    ],
  };
}

/** Resolves every saved SKU in its manual order without imposing a CMS limit. */
export async function getLandingAdminProductsBySkus(
  skus: readonly string[],
): Promise<LandingAdminProduct[]> {
  const orderedSkus = Array.from(
    new Set(skus.map((sku) => sku.trim()).filter(Boolean)),
  );
  if (!orderedSkus.length) return [];

  const products: Array<{
    sku: string;
    name: string;
    slug: string;
    media: Array<{ url: string; thumbUrl: string | null }>;
  }> = [];
  const availableSkus = new Set<string>();

  for (const batch of chunkValues(orderedSkus, QUERY_BATCH_SIZE)) {
    const [rows, available] = await Promise.all([
      db.product.findMany({
        where: { sku: { in: batch } },
        select: {
          sku: true,
          name: true,
          slug: true,
          media: {
            where: { kind: "IMAGE", syncStatus: "READY" },
            select: { url: true, thumbUrl: true },
            orderBy: { order: "asc" },
            take: 1,
          },
        },
      }),
      db.product.findMany({
        where: {
          ...landingStorefrontProductWhere(),
          sku: { in: batch },
          deletedAt: null,
        },
        select: { sku: true },
      }),
    ]);
    products.push(...rows);
    for (const product of available) availableSkus.add(product.sku);
  }

  const bySku = new Map(products.map((product) => [product.sku, product]));
  return orderedSkus.map((sku) => {
    const product = bySku.get(sku);
    if (!product) {
      return {
        sku,
        name: "Proizvod nije pronađen",
        slug: "",
        imageUrl: "",
        availableForWeb: false,
        exists: false,
      };
    }
    return {
      sku,
      name: product.name,
      slug: product.slug,
      imageUrl: resolveSupabaseStorageUrl(
        product.media[0]?.thumbUrl || product.media[0]?.url,
      ),
      availableForWeb: availableSkus.has(sku),
      exists: true,
    };
  });
}

function chunkValues<T>(values: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
