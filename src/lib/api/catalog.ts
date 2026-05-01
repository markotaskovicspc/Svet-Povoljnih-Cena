import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  Category as CategoryDTO,
  Product as ProductDTO,
} from "@/types";
import { num, numOrNull } from "@/lib/api/_helpers";

/**
 * Catalog read layer (Phase 3C).
 *
 * Mirrors the in-memory mock helpers from `src/data/products.ts` so the home
 * page, listings and PDP can swap to DB-backed data once the XML feed populates
 * the schema (Phase 4A). Conversion sits in `mapProduct` — Prisma `Decimal`s
 * become plain numbers, M:N relations become flat arrays.
 */

const productInclude = {
  group: true,
  collection: true,
  action: true,
  categories: { include: { category: true }, orderBy: { category: { level: "asc" } } },
  media: { orderBy: { order: "asc" } },
  pictograms: { include: { pictogram: true } },
  materials: { include: { material: true } },
  assemblyCities: { include: { city: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function mapProduct(p: ProductRow): ProductDTO {
  const sortedCats = [...p.categories].sort(
    (a, b) => (a.category?.level ?? 0) - (b.category?.level ?? 0),
  );
  return {
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    group: p.group?.slug ?? "",
    collection: p.collection?.slug,
    categoryPath: sortedCats.map((c) => c.category.name),
    description: p.description,
    shortDescription: p.shortDescription ?? undefined,
    dimensionsCm: {
      w: num(p.widthCm) || 0,
      d: num(p.depthCm) || 0,
      h: num(p.heightCm) || 0,
    },
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
    action: p.action
      ? {
          id: p.action.id,
          name: p.action.name,
          startsAt: p.action.startsAt.toISOString(),
          endsAt: p.action.endsAt.toISOString(),
          isHero: p.action.isHero,
        }
      : undefined,
    deliveryDays: { min: p.deliveryDaysMin, max: p.deliveryDaysMax },
    allowsAssembly: p.allowsAssembly,
    assemblyCities: p.assemblyCities.map((a) => a.city.name),
    media: {
      images: p.media
        .filter((m) => m.kind === "IMAGE")
        .map((m) => ({
          url: m.url,
          alt: m.alt ?? undefined,
          width: m.width ?? undefined,
          height: m.height ?? undefined,
          blurDataUrl: m.blurDataUrl ?? undefined,
        })),
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

// ── Categories ────────────────────────────────────────────────────────

export interface CategoryNode extends CategoryDTO {
  children: CategoryNode[];
}

export async function getCategoryTree(): Promise<CategoryNode[]> {
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
  return db.category.findUnique({ where: { slug } });
}

export async function getCategoryByPath(path: string) {
  return db.category.findUnique({ where: { path } });
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
}

export interface ListProductsResult {
  items: ProductDTO[];
  nextCursor: string | null;
  total: number;
}

export async function listProducts(
  input: ListProductsInput = {},
): Promise<ListProductsResult> {
  const where: Prisma.ProductWhereInput = { isActive: true };

  if (input.categoryPath) {
    where.categories = {
      some: { category: { path: { startsWith: input.categoryPath } } },
    };
  }
  if (input.actionSlug) {
    where.action = { slug: input.actionSlug };
  }
  if (input.onSaleOnly) where.salePrice = { not: null };
  if (input.heroOnly) where.isHero = true;
  if (input.limitedOnly) where.isLimited = true;
  if (input.newOnly) where.AND = [{ isNew: true }, { OR: [{ newUntil: null }, { newUntil: { gt: new Date() } }] }];
  if (input.outletOnly) where.discountPct = { gte: 30 };
  if (input.inStockOnly) where.stock = { gt: 0 };
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

  const limit = Math.min(Math.max(input.limit ?? 24, 1), 300);

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      include: productInclude,
      orderBy,
      take: limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    }),
    db.product.count({ where }),
  ]);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: slice.map(mapProduct),
    nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    total,
  };
}

export async function getProductBySlug(slug: string): Promise<ProductDTO | null> {
  const row = await db.product.findUnique({ where: { slug }, include: productInclude });
  if (!row) return null;
  return mapProduct(row);
}

export async function getProductBySku(sku: string): Promise<ProductDTO | null> {
  const row = await db.product.findUnique({ where: { sku }, include: productInclude });
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
