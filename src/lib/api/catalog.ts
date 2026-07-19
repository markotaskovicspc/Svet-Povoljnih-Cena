import "server-only";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { db, hasDatabaseConnection } from "@/lib/db";
import type {
  Category as CategoryDTO,
  Product as ProductDTO,
} from "@/types";
import { BRAND } from "@/lib/brand";
import { num, numOrNull } from "@/lib/api/_helpers";
import { isRenderableImageUrl } from "@/lib/media";
import { resolveSupabaseStorageMedia } from "@/lib/supabase/storage";
import {
  effectiveSourcePrice,
  parseSourcePrice,
  sourceLongDescription,
  sourceMediaImages,
  sourceValue,
  svetAkcijaProducts,
  type SvetAkcijaProduct,
} from "@/lib/svet-akcija/catalog";

/**
 * Catalog read layer (Phase 3C).
 *
 * Catalog read layer for imported products. Conversion sits in `mapProduct`:
 * Prisma `Decimal`s become plain numbers, and M:N relations become flat arrays.
 */

const productInclude = {
  group: true,
  collection: true,
  action: true,
  actionPrices: { include: { action: true } },
  categories: { include: { category: true }, orderBy: { category: { level: "asc" } } },
  media: { orderBy: { order: "asc" } },
  pictograms: { include: { pictogram: true } },
  materials: { include: { material: true } },
  assemblyCities: { include: { city: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function categoryPathLabels(
  categories: Array<{ category: { name: string } }>,
): string[] {
  const labels = categories.flatMap((c) =>
    c.category.name
      .split(/\s*\/\s*/)
      .map((label) => label.trim())
      .filter(Boolean),
  );
  return labels.filter((label, index) => label !== labels[index - 1]);
}

const slugify = (input: string) =>
  input
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

const productListSelect = {
  id: true,
  sku: true,
  slug: true,
  name: true,
  shortDescription: true,
  colorPrimary: true,
  colorSecondary: true,
  widthCm: true,
  depthCm: true,
  heightCm: true,
  stock: true,
  incomingStock: true,
  supplierStock: true,
  isHero: true,
  isNew: true,
  newUntil: true,
  isLimited: true,
  isDtz: true,
  fullPrice: true,
  salePrice: true,
  discountPct: true,
  loyaltyPrice: true,
  loyaltyDiscountPct: true,
  deliveryDaysMin: true,
  deliveryDaysMax: true,
  allowsAssembly: true,
  group: true,
  collection: true,
  action: true,
  actionPrices: { include: { action: true } },
  categories: { include: { category: true }, orderBy: { category: { level: "asc" } } },
  // Cards expose a compact preview gallery; the PDP still loads every asset.
  media: {
    where: { kind: "IMAGE" },
    orderBy: { order: "asc" },
    take: 6,
  },
  materials: { include: { material: true } },
} satisfies Prisma.ProductSelect;

type ProductListRow = Prisma.ProductGetPayload<{ select: typeof productListSelect }>;

function mapImageMedia(m: {
  url: string;
  thumbUrl?: string | null;
  cardUrl?: string | null;
  pdpUrl?: string | null;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  blurDataUrl?: string | null;
}) {
  const media = resolveSupabaseStorageMedia(m);
  return {
    url: media.url,
    thumbUrl: media.thumbUrl || undefined,
    cardUrl: media.cardUrl || undefined,
    pdpUrl: media.pdpUrl || undefined,
    alt: m.alt ?? undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    blurDataUrl: m.blurDataUrl ?? undefined,
  };
}

function mapProduct(p: ProductRow): ProductDTO {
  const sortedCats = [...p.categories].sort(
    (a, b) => (a.category?.level ?? 0) - (b.category?.level ?? 0),
  );
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    group: p.group?.slug ?? "",
    collection: p.collection?.slug,
    categoryPath: categoryPathLabels(sortedCats),
    description: p.description,
    shortDescription: p.shortDescription ?? undefined,
    dimensionsCm: {
      w: num(p.widthCm) || 0,
      d: num(p.depthCm) || 0,
      h: num(p.heightCm) || 0,
    },
    colorPrimary: p.colorPrimary ?? undefined,
    colorSecondary: p.colorSecondary ?? undefined,
    materials: p.materials.map((m) => ({
      id: m.material.id,
      label: m.material.label,
      imageUrl: m.material.imageUrl ?? undefined,
    })),
    pictograms: p.pictograms.map((pp) => ({
      id: pp.pictogram.id,
      code: pp.pictogram.code,
      label: pp.pictogram.label,
      iconUrl: pp.pictogram.iconUrl,
    })),
    stock: p.stock,
    incomingStock: p.incomingStock,
    supplierStock: p.supplierStock ?? undefined,
    isHero: p.isHero,
    isNew: p.isNew,
    newUntil: p.newUntil?.toISOString(),
    isLimited: p.isLimited,
    isDtz: p.isDtz,
    fullPrice: num(p.fullPrice),
    salePrice: numOrNull(p.salePrice) ?? undefined,
    discountPct: p.discountPct ?? undefined,
    loyaltyPrice: numOrNull(p.loyaltyPrice) ?? undefined,
    loyaltyDiscountPct: p.loyaltyDiscountPct ?? undefined,
    action: p.action
      ? {
          id: p.action.id,
          name: p.action.name,
          startsAt: p.action.startsAt.toISOString(),
          endsAt: p.action.endsAt.toISOString(),
          isHero: p.action.isHero,
          isPermanent: p.action.isPermanent,
        }
      : undefined,
    actionPrices: p.actionPrices.map((entry) => ({
      price: num(entry.salePrice),
      priority: entry.action.priority,
      startsAt: entry.action.startsAt.toISOString(),
      endsAt: entry.action.endsAt.toISOString(),
      isPermanent: entry.action.isPermanent,
    })),
    pdpInfo: {
      deliveryTerms: p.pdpDeliveryTerms ?? undefined,
      declaration: p.declaration ?? undefined,
      assemblyInstructions: p.assemblyInstructions ?? undefined,
      maintenance: p.maintenance ?? undefined,
    },
    deliveryDays: { min: p.deliveryDaysMin, max: p.deliveryDaysMax },
    allowsAssembly: p.allowsAssembly,
    assemblyCities: p.assemblyCities.map((a) => a.city.name),
    media: {
      images: p.media
        .filter((m) => m.kind === "IMAGE")
        .map(mapImageMedia)
        .filter((m) => isRenderableImageUrl(m.url)),
      video: p.media.find((m) => m.kind === "VIDEO")
        ? { url: p.media.find((m) => m.kind === "VIDEO")!.url }
        : undefined,
      video3d: p.media.find((m) => m.kind === "VIDEO_3D")
        ? { url: p.media.find((m) => m.kind === "VIDEO_3D")!.url }
        : undefined,
    },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  };
}

function sourceDateToIso(value: string) {
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mapSvetAkcijaFallback(product: SvetAkcijaProduct): ProductDTO {
  const sku = sourceValue(product, "Šifra");
  const name = sourceValue(product, "Kratki naziv") || sku;
  const category = sourceValue(product, "Kategorija");
  const group = sourceValue(product, "Grupa");
  const fullPrice = parseSourcePrice(sourceValue(product, "MPC redovna")) ?? 0;
  const sourcePrice = effectiveSourcePrice(product);
  const salePrice = sourcePrice.salePrice ?? undefined;
  const discountPct =
    salePrice && fullPrice > salePrice
      ? Math.round(((fullPrice - salePrice) / fullPrice) * 100)
      : undefined;
  const description = sourceLongDescription(product);

  return {
    sku,
    slug: slugify(`${name}-${sku}`),
    name,
    group: slugify(group),
    collection: slugify(sourceValue(product, "Kolekcija (brend)")),
    categoryPath: [category, group].filter(Boolean),
    description,
    shortDescription: sourceValue(product, "Opis") || undefined,
    dimensionsCm: { w: 0, d: 0, h: 0 },
    colorPrimary: sourceValue(product, "Boja 1") || undefined,
    colorSecondary: sourceValue(product, "Boja 2") || undefined,
    materials: [],
    pictograms: [],
    stock: 0,
    incomingStock: 0,
    isHero: false,
    isNew: false,
    isLimited: false,
    isDtz: false,
    fullPrice,
    salePrice,
    discountPct,
    action: salePrice
      ? {
          id: "svet-akcija",
          name: `${BRAND.name} akcija`,
          startsAt: sourceDateToIso(sourceValue(product, "Važenje akcijske cene od")),
          endsAt: sourceDateToIso(sourceValue(product, "Važenje akcijske cene do")),
          isHero: false,
        }
      : undefined,
    deliveryDays: { min: 3, max: 5 },
    allowsAssembly: false,
    assemblyCities: [],
    media: {
      images:
        sourceMediaImages(product)
          .map((image) => {
            const media = resolveSupabaseStorageMedia({
              url: image.url,
              thumbUrl: image.thumbUrl,
              cardUrl: image.cardUrl,
              pdpUrl: image.pdpUrl,
            });
            return {
              url: media.url,
              thumbUrl: media.thumbUrl || undefined,
              cardUrl: media.cardUrl || undefined,
              pdpUrl: media.pdpUrl || undefined,
              alt: image.alt ?? name,
              width: image.width ?? undefined,
              height: image.height ?? undefined,
              blurDataUrl: image.blurDataUrl ?? undefined,
            };
          })
          .filter((image) => isRenderableImageUrl(image.url)) ?? [],
    },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  };
}

function mapProductListItem(p: ProductListRow): ProductDTO {
  const sortedCats = [...p.categories].sort(
    (a, b) => (a.category?.level ?? 0) - (b.category?.level ?? 0),
  );
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    group: p.group?.slug ?? "",
    collection: p.collection?.slug,
    categoryPath: categoryPathLabels(sortedCats),
    description: "",
    shortDescription: p.shortDescription ?? undefined,
    dimensionsCm: {
      w: num(p.widthCm) || 0,
      d: num(p.depthCm) || 0,
      h: num(p.heightCm) || 0,
    },
    colorPrimary: p.colorPrimary ?? undefined,
    colorSecondary: p.colorSecondary ?? undefined,
    materials: p.materials.map((m) => ({
      id: m.material.id,
      label: m.material.label,
      imageUrl: m.material.imageUrl ?? undefined,
    })),
    pictograms: [],
    stock: p.stock,
    incomingStock: p.incomingStock,
    supplierStock: p.supplierStock ?? undefined,
    isHero: p.isHero,
    isNew: p.isNew,
    newUntil: p.newUntil?.toISOString(),
    isLimited: p.isLimited,
    isDtz: p.isDtz,
    fullPrice: num(p.fullPrice),
    salePrice: numOrNull(p.salePrice) ?? undefined,
    discountPct: p.discountPct ?? undefined,
    loyaltyPrice: numOrNull(p.loyaltyPrice) ?? undefined,
    loyaltyDiscountPct: p.loyaltyDiscountPct ?? undefined,
    action: p.action
      ? {
          id: p.action.id,
          name: p.action.name,
          startsAt: p.action.startsAt.toISOString(),
          endsAt: p.action.endsAt.toISOString(),
          isHero: p.action.isHero,
          isPermanent: p.action.isPermanent,
        }
      : undefined,
    actionPrices: p.actionPrices.map((entry) => ({
      price: num(entry.salePrice),
      priority: entry.action.priority,
      startsAt: entry.action.startsAt.toISOString(),
      endsAt: entry.action.endsAt.toISOString(),
      isPermanent: entry.action.isPermanent,
    })),
    deliveryDays: { min: p.deliveryDaysMin, max: p.deliveryDaysMax },
    allowsAssembly: p.allowsAssembly,
    assemblyCities: [],
    media: {
      images: p.media
        .map(mapImageMedia)
        .filter((m) => isRenderableImageUrl(m.url)),
    },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  };
}

function getSvetAkcijaFallbackBySlug(slug: string): ProductDTO | null {
  if (!allowStaticCatalogFallback()) return null;
  const decoded = decodeURIComponent(slug);
  const product = svetAkcijaProducts.find((item) => {
    const sku = sourceValue(item, "Šifra");
    const name = sourceValue(item, "Kratki naziv") || sku;
    return slugify(`${name}-${sku}`) === decoded;
  });
  return product ? mapSvetAkcijaFallback(product) : null;
}

function allowStaticCatalogFallback() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_STATIC_CATALOG_FALLBACK === "1"
  );
}

// ── Categories ────────────────────────────────────────────────────────

export interface CategoryNode extends CategoryDTO {
  children: CategoryNode[];
}

export async function getCategoryTree(): Promise<CategoryNode[]> {
  if (!hasDatabaseConnection()) return [];
  const rows = await db.category.findMany({ orderBy: [{ level: "asc" }, { order: "asc" }] });
  const byId = new Map<string, CategoryNode>();
  const roots: CategoryNode[] = [];
  for (const c of rows) {
    byId.set(c.id, {
      id: c.id,
      slug: c.slug,
      name: c.name,
      parentId: c.parentId,
      order: c.order,
      imageUrl: c.imageUrl ?? undefined,
      children: [],
    });
  }
  for (const c of rows) {
    const node = byId.get(c.id)!;
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function getCategoryBySlug(slug: string) {
  if (!hasDatabaseConnection()) return null;
  return db.category.findUnique({ where: { slug } });
}

export async function getCategoryByPath(path: string) {
  if (!hasDatabaseConnection()) return null;
  return db.category.findUnique({ where: { path } });
}

export async function getCollectionBySlug(
  slug: string,
): Promise<{ slug: string; name: string } | null> {
  if (!hasDatabaseConnection()) return null;
  return db.collection.findUnique({
    where: { slug },
    select: { slug: true, name: true },
  });
}

// ── Products ──────────────────────────────────────────────────────────

export type ProductSort = "default" | "price-asc" | "price-desc" | "discount-desc";

export interface ListProductsInput {
  /** Filter by category materialized path prefix, e.g. `/namestaj/police`. */
  categoryPath?: string;
  /** Filter by promo action slug (akcija / nedeljna-akcija / heroji-meseca / outlet…). */
  actionSlug?: string;
  /** Restrict to currently-on-sale items (any action OR `salePrice` set). */
  onSaleOnly?: boolean;
  /** Restrict to hero-of-month products. */
  heroOnly?: boolean;
  /** Restrict to "Novo" products whose `newUntil` is in the future. */
  newOnly?: boolean;
  /** Restrict to limited-quantity products. */
  limitedOnly?: boolean;
  /** Restrict to outlet (significant discount). */
  outletOnly?: boolean;
  groupSlug?: string;
  collectionSlug?: string;
  excludeSku?: string;
  /** Restrict to products at or below this effective price. */
  maxPrice?: number;
  priceRange?: [number, number];
  /** Width/depth/height ranges, all in cm. */
  widthRange?: [number, number];
  depthRange?: [number, number];
  heightRange?: [number, number];
  materialIds?: string[];
  inStockOnly?: boolean;
  sort?: ProductSort;
  /** Page size (default 24, max 300). */
  limit?: number;
  /** Cursor = product id; results returned strictly after this id. */
  cursor?: string;
  /** Internal optimization for rails that do not display a result total. */
  includeTotal?: boolean;
}

export interface ListProductsResult {
  items: ProductDTO[];
  nextCursor: string | null;
  total: number;
}

function liveActionWhere(now: Date): Prisma.ActionWhereInput {
  return {
    OR: [
      { isPermanent: true },
      { startsAt: { lte: now }, endsAt: { gte: now } },
    ],
  };
}

function liveSaleWhere(now: Date): Prisma.ProductWhereInput {
  return {
    salePrice: { not: null },
    OR: [{ actionId: null }, { action: { is: liveActionWhere(now) } }],
  };
}

function appendAnd(where: Prisma.ProductWhereInput, condition: Prisma.ProductWhereInput) {
  const current = where.AND;
  where.AND = [
    ...(Array.isArray(current) ? current : current ? [current] : []),
    condition,
  ];
}

export async function listProducts(
  input: ListProductsInput = {},
): Promise<ListProductsResult> {
  if (!hasDatabaseConnection()) {
    return { items: [], nextCursor: null, total: 0 };
  }

  const where: Prisma.ProductWhereInput = { isActive: true };
  const now = new Date();

  if (input.categoryPath) {
    where.categories = {
      some: { category: { path: { startsWith: input.categoryPath } } },
    };
  }
  if (input.actionSlug) {
    where.action = { is: { slug: input.actionSlug, ...liveActionWhere(now) } };
  }
  if (input.onSaleOnly) appendAnd(where, liveSaleWhere(now));
  if (input.heroOnly) where.isHero = true;
  if (input.limitedOnly) where.isLimited = true;
  if (input.newOnly) appendAnd(where, { isNew: true, OR: [{ newUntil: null }, { newUntil: { gt: now } }] });
  if (input.outletOnly) {
    appendAnd(where, { discountPct: { gte: 30 }, ...liveSaleWhere(now) });
  }
  if (input.groupSlug) where.group = { slug: input.groupSlug };
  if (input.collectionSlug) where.collection = { slug: input.collectionSlug };
  if (input.excludeSku) where.sku = { not: input.excludeSku };
  if (input.inStockOnly) where.stock = { gt: 0 };
  if (input.maxPrice != null) {
    where.OR = [
      { salePrice: { lte: input.maxPrice } },
      { AND: [{ salePrice: null }, { fullPrice: { lte: input.maxPrice } }] },
    ];
  }
  if (input.priceRange) {
    where.OR = [
      { salePrice: { gte: input.priceRange[0], lte: input.priceRange[1] } },
      { AND: [{ salePrice: null }, { fullPrice: { gte: input.priceRange[0], lte: input.priceRange[1] } }] },
    ];
  }
  if (input.widthRange) where.widthCm = { gte: input.widthRange[0], lte: input.widthRange[1] };
  if (input.depthRange) where.depthCm = { gte: input.depthRange[0], lte: input.depthRange[1] };
  if (input.heightRange) where.heightCm = { gte: input.heightRange[0], lte: input.heightRange[1] };
  if (input.materialIds?.length) {
    where.materials = { some: { materialId: { in: input.materialIds } } };
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput[] = (() => {
    switch (input.sort) {
      case "price-asc":
        return [{ salePrice: "asc" }, { fullPrice: "asc" }];
      case "price-desc":
        return [{ salePrice: "desc" }, { fullPrice: "desc" }];
      case "discount-desc":
        return [{ discountPct: "desc" }, { fullPrice: "asc" }];
      default:
        return [{ isHero: "desc" }, { discountPct: "desc" }, { fullPrice: "asc" }];
    }
  })();
  orderBy.push({ id: "asc" });

  const limit = Math.min(Math.max(input.limit ?? 24, 1), 300);

  const rowsQuery = db.product.findMany({
    where,
    select: productListSelect,
    orderBy,
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const [rows, total] =
    input.includeTotal === false
      ? [await rowsQuery, 0]
      : await Promise.all([rowsQuery, db.product.count({ where })]);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: slice.map(mapProductListItem),
    nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    total,
  };
}

export const getProductBySlug = cache(async function getProductBySlug(
  slug: string,
): Promise<ProductDTO | null> {
  if (!hasDatabaseConnection()) return getSvetAkcijaFallbackBySlug(slug);
  try {
    const row = await db.product.findFirst({
      where: { slug, isActive: true },
      include: productInclude,
    });
    if (!row) return getSvetAkcijaFallbackBySlug(slug);
    return mapProduct(row);
  } catch (error) {
    console.error(`[catalog] Failed to load product by slug "${slug}".`, error);
    return getSvetAkcijaFallbackBySlug(slug);
  }
});

/**
 * Batch loader for listing cards.
 *
 * Search results already contain the ordered slugs. Loading every card through
 * `getProductBySlug` creates one full product query per hit; this keeps the
 * result order while resolving the page with one listing-shaped query.
 */
export async function getProductCardsBySlugs(
  slugs: readonly string[],
): Promise<ProductDTO[]> {
  const orderedSlugs = Array.from(
    new Set(slugs.map((slug) => slug.trim()).filter(Boolean)),
  ).slice(0, 120);
  if (!orderedSlugs.length) return [];
  if (!hasDatabaseConnection()) {
    return orderedSlugs
      .map(getSvetAkcijaFallbackBySlug)
      .filter((product): product is ProductDTO => Boolean(product));
  }

  try {
    const rows = await db.product.findMany({
      where: { slug: { in: orderedSlugs }, isActive: true },
      select: productListSelect,
    });
    const productsBySlug = new Map(
      rows.map((row) => [row.slug, mapProductListItem(row)]),
    );
    return orderedSlugs
      .map((slug) => productsBySlug.get(slug))
      .filter((product): product is ProductDTO => Boolean(product));
  } catch (error) {
    console.error("[catalog] Failed to batch-load product cards.", error);
    return [];
  }
}

export async function getProductBySku(sku: string): Promise<ProductDTO | null> {
  if (!hasDatabaseConnection()) return null;
  const row = await db.product.findFirst({
    where: { sku, isActive: true },
    include: productInclude,
  });
  if (!row) return null;
  return mapProduct(row);
}

/** "Često kupovano zajedno" — items in the same `collection`. */
export async function getFrequentlyBought(productId: string, limit = 6) {
  const p = await db.product.findUnique({
    where: { id: productId },
    select: { collectionId: true },
  });
  if (!p?.collectionId) return [];
  const rows = await db.product.findMany({
    where: { collectionId: p.collectionId, id: { not: productId }, isActive: true },
    include: productInclude,
    take: limit,
    orderBy: [{ isHero: "desc" }, { discountPct: "desc" }],
  });
  return rows.map(mapProduct);
}

/** "Slični artikli" — items in the same `group`. */
export async function getRelatedProducts(productId: string, limit = 8) {
  const p = await db.product.findUnique({
    where: { id: productId },
    select: { groupId: true },
  });
  if (!p?.groupId) return [];
  const rows = await db.product.findMany({
    where: { groupId: p.groupId, id: { not: productId }, isActive: true },
    include: productInclude,
    take: limit,
    orderBy: [{ isHero: "desc" }, { discountPct: "desc" }],
  });
  return rows.map(mapProduct);
}

/** Cross-sell list backing the post-add-to-cart "Predlog kupovine" modal. */
export async function getRecommendationsForGroup(groupSlug: string, limit = 6) {
  const rule = await db.recommendationRule.findFirst({
    where: { enabled: true, group: { slug: groupSlug } },
    include: { products: { include: productInclude } },
    orderBy: { order: "asc" },
  });
  if (!rule) return [];
  return rule.products.slice(0, limit).map(mapProduct);
}

export async function getCartRecommendationsForSkus(
  skus: string[],
  limit = 6,
): Promise<ProductDTO[]> {
  if (!hasDatabaseConnection()) return [];
  const uniqueSkus = Array.from(new Set(skus.map((sku) => sku.trim()).filter(Boolean)));
  if (!uniqueSkus.length) return [];

  const cartProducts = await db.product.findMany({
    where: { sku: { in: uniqueSkus }, isActive: true },
    select: { groupId: true },
  });
  const groupIds = Array.from(
    new Set(cartProducts.map((product) => product.groupId).filter((id): id is string => Boolean(id))),
  );
  if (!groupIds.length) return [];

  const rules = await db.recommendationRule.findMany({
    where: { enabled: true, groupId: { in: groupIds } },
    include: { products: { include: productInclude } },
    orderBy: [{ order: "asc" }],
  });

  const seen = new Set(uniqueSkus);
  const out: ProductDTO[] = [];
  for (const rule of rules) {
    for (const product of rule.products) {
      if (seen.has(product.sku) || !product.isActive) continue;
      seen.add(product.sku);
      out.push(mapProduct(product));
      if (out.length >= limit) return out;
    }
  }
  return out;
}
