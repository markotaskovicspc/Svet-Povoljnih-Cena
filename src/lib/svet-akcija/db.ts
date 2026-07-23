import "server-only";

import { db, hasDatabaseConnection } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { isRenderableImageUrl } from "@/lib/media";
import { resolveSupabaseStorageUrl } from "@/lib/supabase/storage";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";
import {
  sourceValue,
  svetAkcijaProducts,
  type SvetAkcijaProduct,
} from "@/lib/svet-akcija/catalog";

type DbSvetAkcijaProduct = Awaited<ReturnType<typeof fetchDbProducts>>[number];

function decimalToSourceValue(value: unknown): string | null {
  if (value == null) return null;
  const raw = value.toString();
  return raw.endsWith(".00") ? raw.slice(0, -3) : raw;
}

async function fetchDbProducts() {
  if (!hasDatabaseConnection()) return [];

  try {
    return await db.product.findMany({
      where: {
        ...webStorefrontProductWhere(),
        sku: { in: svetAkcijaProducts.map((product) => sourceValue(product, "Šifra")) },
      },
      select: {
        sku: true,
        name: true,
        description: true,
        shortDescription: true,
        fullPrice: true,
        salePrice: true,
        media: {
          where: { kind: "IMAGE" },
          orderBy: { order: "asc" },
          select: {
            url: true,
            alt: true,
            width: true,
            height: true,
            blurDataUrl: true,
          },
        },
      },
    });
  } catch (error) {
    console.error(`Failed to load ${BRAND.name} products from database`, error);
    return [];
  }
}

function mergeProduct(base: SvetAkcijaProduct, row: DbSvetAkcijaProduct | undefined) {
  if (!row) return base;

  const shortDescription = row.shortDescription ?? sourceValue(base, "Opis");
  const fullPrice = decimalToSourceValue(row.fullPrice) ?? sourceValue(base, "MPC redovna");
  const salePrice = decimalToSourceValue(row.salePrice) ?? sourceValue(base, "Akcijska MPC");
  const images = row.media
    .map((media) => ({
      ...media,
      url: resolveSupabaseStorageUrl(media.url),
    }))
    .filter((media) => isRenderableImageUrl(media.url));

  return {
    ...base,
    source: {
      ...base.source,
      "Kratki naziv": row.name,
      "Opis": shortDescription,
      "MPC redovna": fullPrice,
      "Akcijska MPC": salePrice,
    },
    website_mapping: {
      ...base.website_mapping,
      title: row.name,
      shortDescription,
      regularPrice: fullPrice,
      salePrice,
      sku: row.sku,
    },
    longDescription: row.description,
    media: { images },
  } satisfies SvetAkcijaProduct;
}

export async function getSvetAkcijaProducts() {
  const rows = await fetchDbProducts();
  if (!rows.length) return svetAkcijaProducts;

  const bySku = new Map(rows.map((row) => [row.sku, row]));
  return svetAkcijaProducts.map((product) =>
    mergeProduct(product, bySku.get(sourceValue(product, "Šifra"))),
  );
}

export async function getSvetAkcijaProductBySku(sku: string) {
  const decoded = decodeURIComponent(sku);
  const products = await getSvetAkcijaProducts();
  return products.find((product) => sourceValue(product, "Šifra") === decoded);
}

export async function getRelatedSvetAkcijaProducts(product: SvetAkcijaProduct, limit = 4) {
  const products = await getSvetAkcijaProducts();
  return products
    .filter(
      (item) =>
        sourceValue(item, "Šifra") !== sourceValue(product, "Šifra") &&
        sourceValue(item, "Kategorija") === sourceValue(product, "Kategorija") &&
        sourceValue(item, "Grupa") === sourceValue(product, "Grupa"),
    )
    .slice(0, limit);
}
