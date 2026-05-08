import "server-only";

import { db } from "@/lib/db";
import type { FeedProduct } from "./types";
import { getFeedsConfig } from "./config";

export type FeedChannel = "google" | "meta" | "tiktok";

const channelFlagField = {
  google: "inGoogleMerchant",
  meta: "inMetaCatalog",
  tiktok: "inTiktokCatalog",
} as const;

interface RowMedia {
  url: string;
  order: number;
}

interface RowCategory {
  category: { path: string; name: string };
}

interface ProductRow {
  id: string;
  sku: string;
  slug: string;
  name: string;
  description: string;
  shortDescription: string | null;
  fullPrice: { toString(): string };
  salePrice: { toString(): string } | null;
  stock: number;
  incomingStock: number;
  isActive: boolean;
  inGoogleMerchant: boolean;
  inMetaCatalog: boolean;
  inTiktokCatalog: boolean;
  media: RowMedia[];
  categories: RowCategory[];
}

function toMajor(value: { toString(): string } | null): number | null {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

function pickAvailability(row: ProductRow): FeedProduct["availability"] {
  if (row.stock > 0) return "in stock";
  if (row.incomingStock > 0) return "preorder";
  return "out of stock";
}

function stripHtml(input: string): string {
  return input
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Load active products flagged for a given ad channel and project them
 * into the channel-agnostic `FeedProduct` shape. The query intentionally
 * avoids variants for v1 — Phase 5 will introduce per-variant feed items.
 */
export async function loadFeedProducts(channel: FeedChannel): Promise<FeedProduct[]> {
  const cfg = getFeedsConfig();
  const flag = channelFlagField[channel];

  const rows = (await db.product.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      [flag]: true,
    },
    take: cfg.maxItems,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      sku: true,
      slug: true,
      name: true,
      description: true,
      shortDescription: true,
      fullPrice: true,
      salePrice: true,
      stock: true,
      incomingStock: true,
      isActive: true,
      inGoogleMerchant: true,
      inMetaCatalog: true,
      inTiktokCatalog: true,
      media: {
        where: { kind: "IMAGE" },
        orderBy: { order: "asc" },
        select: { url: true, order: true },
      },
      categories: {
        select: { category: { select: { path: true, name: true } } },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any as ProductRow[];

  const items: FeedProduct[] = [];
  for (const row of rows) {
    const price = toMajor(row.fullPrice);
    if (price == null || price <= 0) continue;
    const sale = toMajor(row.salePrice);
    const primaryImage = row.media[0]?.url;
    if (!primaryImage) continue; // GMC + Meta both require an image

    const link = `${cfg.baseUrl}/p/${row.slug}`;
    const imageLink = primaryImage.startsWith("http")
      ? primaryImage
      : `${cfg.baseUrl}${primaryImage.startsWith("/") ? "" : "/"}${primaryImage}`;
    const extras = row.media
      .slice(1, 11)
      .map((m) =>
        m.url.startsWith("http") ? m.url : `${cfg.baseUrl}${m.url.startsWith("/") ? "" : "/"}${m.url}`,
      );

    const productType =
      row.categories
        .map((c) => c.category.path)
        .sort((a, b) => b.length - a.length)[0]
        ?.split("/")
        .filter(Boolean)
        .join(" > ") || null;

    items.push({
      id: row.sku,
      sku: row.sku,
      title: row.name.slice(0, 150),
      description:
        stripHtml(row.shortDescription ?? row.description).slice(0, 5000) || row.name,
      link,
      imageLink,
      additionalImageLinks: extras,
      price,
      salePrice: sale != null && sale < price ? sale : null,
      currency: cfg.currency,
      availability: pickAvailability(row),
      brand: cfg.defaultBrand,
      condition: "new",
      googleProductCategory: cfg.defaultGoogleCategory || null,
      productType,
      gtin: null,
      mpn: row.sku,
    });
  }
  return items;
}
