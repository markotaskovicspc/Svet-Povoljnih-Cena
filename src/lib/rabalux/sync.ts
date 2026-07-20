import "server-only";

import { Prisma, type Supplier } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import {
  fetchRabaluxFeed,
  isRabaluxSupplierOperational,
  RABALUX_INTEGRATION_KEY,
  rabaluxCatalogCredentials,
  rabaluxStockCredentials,
} from "./config";
import {
  parseRabaluxCatalogCsv,
  parseRabaluxCatalogXml,
  parseRabaluxStockCsv,
  rabaluxMediaStorageKey,
  summarizeRabaluxDryRun,
} from "./parser";
import type {
  RabaluxCatalogItem,
  RabaluxStockItem,
} from "./types";

const MAX_RECORDED_ERRORS = 50;
const ITEM_CONCURRENCY = 6;

type SyncSummary = {
  runId: string;
  kind: "CATALOG" | "STOCK";
  read: number;
  ok: number;
  failed: number;
  created: number;
  updated: number;
  mediaQueued: number;
  errors: Array<{ sourceSku?: string; message: string }>;
  metadata: Record<string, unknown>;
};

async function getSupplier(requireEnabled = false) {
  const supplier = await db.supplier.findUnique({
    where: { integrationKey: RABALUX_INTEGRATION_KEY },
  });
  if (!supplier) {
    throw new Error("Rabalux supplier migration has not been applied.");
  }
  if (requireEnabled && !isRabaluxSupplierOperational(supplier)) {
    throw new Error("Rabalux integration is disabled.");
  }
  return supplier;
}

async function closeRun(
  runId: string,
  summary: SyncSummary,
) {
  const status =
    summary.failed === 0 ? "SUCCESS" : summary.ok > 0 ? "PARTIAL" : "FAILED";
  await db.importRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      recordsRead: summary.read,
      recordsOk: summary.ok,
      recordsFail: summary.failed,
      errorMessage: summary.errors[0]?.message ?? null,
      errors: summary.errors.length
        ? (summary.errors as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      metadata: summary.metadata as Prisma.InputJsonValue,
    },
  });
  return summary;
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/[^@\s]+@/gi, "https://")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 1000);
}

function configuredMinimumRows(name: string, fallback: number) {
  const configured = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(configured) && configured > 0 ? configured : fallback;
}

function assertMinimumFeedRows(kind: string, actual: number, minimum: number) {
  if (actual < minimum) {
    throw new Error(
      `Rabalux ${kind} feed has ${actual} row(s); expected at least ${minimum}.`,
    );
  }
}

export async function fetchRabaluxCatalog(supplier: Supplier) {
  if (!supplier.feedUrl) throw new Error("Rabalux XML feed URL is missing.");
  const credentials = rabaluxCatalogCredentials(supplier);
  try {
    const raw = await fetchRabaluxFeed(
      supplier.feedUrl,
      credentials,
      "application/xml, text/xml, */*;q=0.5",
    );
    const items = parseRabaluxCatalogXml(raw);
    assertMinimumFeedRows(
      "catalog",
      items.length,
      configuredMinimumRows("RABALUX_MIN_CATALOG_ROWS", 2_000),
    );
    return { source: "XML" as const, items };
  } catch (xmlError) {
    if (!supplier.catalogFallbackUrl) throw xmlError;
    const raw = await fetchRabaluxFeed(
      supplier.catalogFallbackUrl,
      credentials,
      "text/csv, text/plain, */*;q=0.5",
    );
    const items = parseRabaluxCatalogCsv(raw);
    assertMinimumFeedRows(
      "catalog fallback",
      items.length,
      configuredMinimumRows("RABALUX_MIN_CATALOG_ROWS", 2_000),
    );
    return {
      source: "CSV" as const,
      items,
      fallbackReason: safeMessage(xmlError),
    };
  }
}

export async function fetchRabaluxStock(supplier: Supplier) {
  if (!supplier.stockFeedUrl) throw new Error("Rabalux stock feed URL is missing.");
  const raw = await fetchRabaluxFeed(
    supplier.stockFeedUrl,
    rabaluxStockCredentials(supplier),
    "text/csv, text/plain, */*;q=0.5",
  );
  const items = parseRabaluxStockCsv(raw);
  assertMinimumFeedRows(
    "stock",
    items.length,
    configuredMinimumRows("RABALUX_MIN_STOCK_ROWS", 2_000),
  );
  return items;
}

export async function inspectRabaluxLiveFeeds() {
  const supplier = await getSupplier();
  const [{ source, items: catalog }, stock] = await Promise.all([
    fetchRabaluxCatalog(supplier),
    fetchRabaluxStock(supplier),
  ]);
  return { source, ...summarizeRabaluxDryRun(catalog, stock) };
}

export async function syncRabaluxCatalog() {
  const supplier = await getSupplier(true);
  const run = await db.importRun.create({
    data: { supplierId: supplier.id, kind: "CATALOG", status: "RUNNING" },
  });
  const summary: SyncSummary = {
    runId: run.id,
    kind: "CATALOG",
    read: 0,
    ok: 0,
    failed: 0,
    created: 0,
    updated: 0,
    mediaQueued: 0,
    errors: [],
    metadata: {},
  };
  try {
    const catalog = await fetchRabaluxCatalog(supplier);
    summary.read = catalog.items.length;
    summary.metadata.source = catalog.source;
    if (catalog.fallbackReason) {
      summary.metadata.xmlFallbackReason = catalog.fallbackReason;
    }
    const seen = new Set<string>();
    for (let start = 0; start < catalog.items.length; start += ITEM_CONCURRENCY) {
      const batch = catalog.items.slice(start, start + ITEM_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((item) => upsertCatalogItem(supplier, item)),
      );
      results.forEach((result, index) => {
        const item = batch[index];
        seen.add(item.sourceSku);
        if (result.status === "fulfilled") {
          summary.ok++;
          summary[result.value.created ? "created" : "updated"]++;
          if (result.value.mediaQueued) summary.mediaQueued++;
        } else {
          summary.failed++;
          if (summary.errors.length < MAX_RECORDED_ERRORS) {
            summary.errors.push({
              sourceSku: item.sourceSku,
              message: safeMessage(result.reason),
            });
          }
        }
      });
    }
    const disappeared = await db.product.updateMany({
      where: {
        supplierId: supplier.id,
        supplierExternalId: { notIn: [...seen] },
        deletedAt: null,
      },
      data: { isActive: false },
    });
    summary.metadata.disappeared = disappeared.count;
    summary.metadata.invalid = catalog.items.filter((item) => !item.valid).length;
    return await closeRun(run.id, summary);
  } catch (error) {
    summary.failed = Math.max(summary.failed, 1);
    summary.errors.push({ message: safeMessage(error) });
    await closeRun(run.id, summary);
    throw error;
  }
}

async function upsertCatalogItem(supplier: Supplier, item: RabaluxCatalogItem) {
  const result = await db.$transaction(async (tx) => {
    const categoryId =
      item.category && item.type
        ? await ensureCategory(tx, [item.category, item.type])
        : null;
    const groupId = item.type ? await ensureGroup(tx, item.type) : null;
    const existing = await tx.product.findUnique({
      where: {
        supplierId_supplierExternalId: {
          supplierId: supplier.id,
          supplierExternalId: item.sourceSku,
        },
      },
      select: {
        id: true,
        syncOverrides: true,
        articleStatus: true,
        media: { select: { sourceUrl: true, kind: true, order: true, syncStatus: true } },
        attachments: {
          select: { sourceUrl: true, kind: true, order: true, syncStatus: true },
        },
      },
    });
    const overrideFields = parseOverrideFields(existing?.syncOverrides);
    const incomingMedia = item.media.map((asset) => ({
      sourceUrl: asset.sourceUrl,
      kind: asset.kind,
      order: asset.order,
    }));
    const incomingAttachments = item.attachments.map((asset) => ({
      sourceUrl: asset.sourceUrl,
      kind: asset.kind,
      order: asset.order,
    }));
    const mediaChanged =
      !existing ||
      (!overrideFields.has("media") &&
        signature(existing.media) !== signature(incomingMedia));
    const attachmentsChanged =
      !existing ||
      (!overrideFields.has("attachments") &&
        signature(existing.attachments) !== signature(incomingAttachments));
    const hasReadyImage =
      !mediaChanged &&
      existing?.media.some(
        (asset) => asset.kind === "IMAGE" && asset.syncStatus === "READY",
      );
    const activeCandidate =
      item.valid &&
      existing?.articleStatus !== "ARH" &&
      Boolean(hasReadyImage);

    const data: Prisma.ProductUncheckedCreateInput = {
      sku: item.sku,
      barcode: item.barcode,
      slug: item.slug,
      name: item.name,
      description: item.description,
      shortDescription: item.description
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 320) || null,
      colorPrimary: item.colorPrimary,
      colorSecondary: item.colorSecondary,
      groupId,
      widthCm: decimal(item.widthCm),
      depthCm: decimal(item.depthCm),
      heightCm: decimal(item.heightCm),
      weightKg: decimal(item.weightKg),
      grossWeightKg: decimal(item.grossWeightKg),
      packWidthCm: decimal(item.packWidthCm),
      packDepthCm: decimal(item.packDepthCm),
      packHeightCm: decimal(item.packHeightCm),
      packGrossWeightKg: decimal(item.packGrossWeightKg),
      fullPrice: new Prisma.Decimal(item.fullPrice),
      salePrice: decimal(item.salePrice),
      discountPct: item.discountPct,
      technicalSpecs: item.technicalSpecs as Prisma.InputJsonValue,
      warrantyYears: item.warrantyYears,
      countryOfOrigin: item.countryOfOrigin,
      hsCode: item.hsCode,
      isNew: item.isNew,
      stock: 0,
      incomingStock: 0,
      supplierStock: 0,
      deliveryDaysMin: 7,
      deliveryDaysMax: 10,
      allowsAssembly: false,
      supplierId: supplier.id,
      supplierExternalId: item.sourceSku,
      isActive: activeCandidate,
    };

    let productId: string;
    if (existing) {
      const updateData = applyOverrides(data, overrideFields);
      delete (updateData as Record<string, unknown>).stock;
      delete (updateData as Record<string, unknown>).supplierStock;
      delete (updateData as Record<string, unknown>).incomingStock;
      if (item.valid && !mediaChanged) {
        delete (updateData as Record<string, unknown>).isActive;
      }
      if (overrideFields.has("media")) {
        delete (updateData as Record<string, unknown>).isActive;
      }
      await tx.product.update({ where: { id: existing.id }, data: updateData });
      productId = existing.id;
    } else {
      const created = await tx.product.create({ data, select: { id: true } });
      productId = created.id;
    }

    if (
      categoryId &&
      !overrideFields.has("categories") &&
      !overrideFields.has("category")
    ) {
      await tx.productCategory.deleteMany({ where: { productId } });
      await tx.productCategory.create({ data: { productId, categoryId } });
    }

    if (!overrideFields.has("materials")) {
      const materialIds: string[] = [];
      for (const label of item.materials) {
        const material = await tx.material.upsert({
          where: { slug: slugify(label) },
          create: { slug: slugify(label), label },
          update: { label },
          select: { id: true },
        });
        materialIds.push(material.id);
      }
      await tx.productMaterial.deleteMany({ where: { productId } });
      if (materialIds.length) {
        await tx.productMaterial.createMany({
          data: materialIds.map((materialId) => ({ productId, materialId })),
        });
      }
    }

    if (mediaChanged && !overrideFields.has("media")) {
      await tx.productMedia.deleteMany({ where: { productId } });
      if (item.media.length) {
        await tx.productMedia.createMany({
          data: item.media.map((asset) => ({
            productId,
            kind: asset.kind,
            sourceUrl: asset.sourceUrl,
            url: rabaluxMediaStorageKey(item.sourceSku, asset.sourceUrl, "original"),
            syncStatus: "PENDING",
            alt: asset.kind === "IMAGE" ? item.name : null,
            order: asset.order,
          })),
        });
      }
      await tx.product.update({ where: { id: productId }, data: { isActive: false } });
    }

    if (attachmentsChanged && !overrideFields.has("attachments")) {
      await tx.productAttachment.deleteMany({ where: { productId } });
      if (item.attachments.length) {
        await tx.productAttachment.createMany({
          data: item.attachments.map((asset) => ({
            productId,
            kind: asset.kind,
            label: asset.label,
            sourceUrl: asset.sourceUrl,
            url: rabaluxMediaStorageKey(item.sourceSku, asset.sourceUrl, "documents"),
            syncStatus: "PENDING",
            order: asset.order,
          })),
        });
      }
    }

    const nextMedia = await tx.productMedia.findFirst({
      where: { productId, syncStatus: { not: "READY" } },
      orderBy: [{ syncStatus: "asc" }, { order: "asc" }],
      select: { id: true },
    });
    const nextAttachment = nextMedia
      ? null
      : await tx.productAttachment.findFirst({
          where: { productId, syncStatus: { not: "READY" } },
          orderBy: [{ syncStatus: "asc" }, { order: "asc" }],
          select: { id: true },
        });
    return {
      productId,
      created: !existing,
      mediaQueued: mediaChanged || attachmentsChanged,
      mediaTarget: nextMedia
        ? { assetId: nextMedia.id, assetType: "MEDIA" as const }
        : nextAttachment
          ? {
              assetId: nextAttachment.id,
              assetType: "ATTACHMENT" as const,
            }
          : null,
    };
  });

  if (result.mediaQueued && result.mediaTarget) {
    await enqueueBackgroundJob({
      kind: "RABALUX_MEDIA_PRODUCT",
      payload: { productId: result.productId, ...result.mediaTarget },
      idempotencyKey: `rabalux-media-asset:${result.mediaTarget.assetType}:${result.mediaTarget.assetId}`,
      maxAttempts: 12,
    });
  }
  return result;
}

export async function syncRabaluxStock() {
  const supplier = await getSupplier(true);
  const run = await db.importRun.create({
    data: { supplierId: supplier.id, kind: "STOCK", status: "RUNNING" },
  });
  const summary: SyncSummary = {
    runId: run.id,
    kind: "STOCK",
    read: 0,
    ok: 0,
    failed: 0,
    created: 0,
    updated: 0,
    mediaQueued: 0,
    errors: [],
    metadata: {},
  };
  try {
    const stock = await fetchRabaluxStock(supplier);
    summary.read = stock.length;
    const products = await db.product.findMany({
      where: { supplierId: supplier.id, deletedAt: null },
      select: {
        id: true,
        supplierExternalId: true,
        supplierStock: true,
        supplierNextArrivalAt: true,
      },
    });
    const productBySourceSku = new Map(
      products
        .filter((product) => product.supplierExternalId)
        .map((product) => [product.supplierExternalId!, product]),
    );
    const seen = new Set<string>();
    const stockOnly: string[] = [];
    for (let start = 0; start < stock.length; start += ITEM_CONCURRENCY) {
      const batch = stock.slice(start, start + ITEM_CONCURRENCY);
      await Promise.all(
        batch.map(async (item) => {
          seen.add(item.sourceSku);
          const product = productBySourceSku.get(item.sourceSku);
          if (!product) {
            stockOnly.push(item.sourceSku);
            summary.ok++;
            return;
          }
          await updateStockItem(supplier.id, product, item);
          summary.ok++;
          summary.updated++;
        }),
      );
    }
    const catalogOnly = products.filter(
      (product) =>
        product.supplierExternalId && !seen.has(product.supplierExternalId),
    );
    for (let start = 0; start < catalogOnly.length; start += ITEM_CONCURRENCY) {
      await Promise.all(
        catalogOnly.slice(start, start + ITEM_CONCURRENCY).map(async (product) => {
          if ((product.supplierStock ?? 0) !== 0) {
            await db.supplierStockSnapshot.create({
              data: {
                supplierId: supplier.id,
                productId: product.id,
                externalSku: product.supplierExternalId!,
                stock: 0,
                incomingStock: 0,
              },
            });
          }
          await db.product.update({
            where: { id: product.id },
            data: { supplierStock: 0, supplierNextArrivalAt: null },
          });
        }),
      );
    }
    summary.metadata.stockOnly = stockOnly.sort();
    summary.metadata.catalogOnly = catalogOnly
      .map((product) => product.supplierExternalId)
      .filter(Boolean)
      .sort();
    summary.metadata.restricted = stock.filter((item) => item.restricted).length;
    summary.metadata.outgoing = stock.filter((item) => item.outgoing).length;
    return await closeRun(run.id, summary);
  } catch (error) {
    summary.failed = Math.max(summary.failed, 1);
    summary.errors.push({ message: safeMessage(error) });
    await closeRun(run.id, summary);
    throw error;
  }
}

async function updateStockItem(
  supplierId: string,
  product: {
    id: string;
    supplierExternalId: string | null;
    supplierStock: number | null;
    supplierNextArrivalAt: Date | null;
  },
  item: RabaluxStockItem,
) {
  const nextStatus = item.restricted ? "ARH" : item.outgoing ? "DTZ" : "SP";
  await db.$transaction(async (tx) => {
    const stockChanged =
      (product.supplierStock ?? 0) !== item.stock ||
      product.supplierNextArrivalAt?.getTime() !== item.nextArrivalAt?.getTime();
    if (stockChanged) {
      await tx.supplierStockSnapshot.create({
        data: {
          supplierId,
          productId: product.id,
          externalSku: item.sourceSku,
          stock: item.stock,
          incomingStock: 0,
        },
      });
    }
    await tx.product.update({
      where: { id: product.id },
      data: {
        supplierStock: item.stock,
        supplierNextArrivalAt: item.nextArrivalAt,
        isDtz: item.outgoing,
        articleStatus: nextStatus,
        ...(item.restricted ? { isActive: false } : {}),
      },
    });
    if (!item.restricted) {
      const readiness = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        select: {
          fullPrice: true,
          categories: { select: { categoryId: true }, take: 1 },
          media: {
            where: { kind: "IMAGE", syncStatus: "READY" },
            select: { id: true },
            take: 1,
          },
        },
      });
      await tx.product.update({
        where: { id: product.id },
        data: {
          isActive:
            Number(readiness.fullPrice) > 0 &&
            readiness.categories.length > 0 &&
            readiness.media.length > 0,
        },
      });
    }
  });
}

function decimal(value: number | null) {
  return value == null ? null : new Prisma.Decimal(value);
}

function signature(
  values: Array<{
    sourceUrl: string | null;
    kind: string;
    order: number;
  }>,
) {
  return JSON.stringify(
    values
      .map(({ sourceUrl, kind, order }) => ({ sourceUrl, kind, order }))
      .sort((left, right) => left.order - right.order),
  );
}

function parseOverrideFields(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Set<string>();
  const fields = (value as Record<string, unknown>).fields;
  if (!Array.isArray(fields)) return new Set<string>();
  return new Set(
    fields
      .map((field) => (typeof field === "string" ? field.trim() : ""))
      .filter(Boolean),
  );
}

function applyOverrides(
  data: Prisma.ProductUncheckedCreateInput,
  fields: Set<string>,
) {
  const output: Record<string, unknown> = { ...data };
  const groups: Record<string, string[]> = {
    identity: ["sku", "slug", "name", "barcode"],
    name: ["name"],
    description: ["description", "shortDescription"],
    pricing: ["fullPrice", "salePrice", "discountPct"],
    price: ["fullPrice", "salePrice", "discountPct"],
    dimensions: [
      "widthCm",
      "depthCm",
      "heightCm",
      "weightKg",
      "grossWeightKg",
      "packWidthCm",
      "packDepthCm",
      "packHeightCm",
      "packGrossWeightKg",
    ],
    delivery: ["deliveryDaysMin", "deliveryDaysMax"],
    grouping: ["groupId"],
    specifications: ["technicalSpecs", "warrantyYears", "countryOfOrigin", "hsCode"],
  };
  for (const field of fields) {
    for (const key of groups[field] ?? [field]) delete output[key];
  }
  return output as Prisma.ProductUncheckedUpdateInput;
}

async function ensureCategory(tx: Prisma.TransactionClient, segments: string[]) {
  let parentId: string | null = null;
  let path = "";
  let id = "";
  for (let level = 0; level < segments.length; level++) {
    const name = segments[level].trim();
    const slug = slugify(name);
    path = `${path}/${slug}`;
    const category = await tx.category.upsert({
      where: { path },
      create: { slug, name, parentId, path, level },
      update: { name, parentId, level },
      select: { id: true },
    });
    id = category.id;
    parentId = id;
  }
  return id;
}

async function ensureGroup(tx: Prisma.TransactionClient, name: string) {
  return (
    await tx.group.upsert({
      where: { slug: slugify(name) },
      create: { slug: slugify(name), name },
      update: { name },
      select: { id: true },
    })
  ).id;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/š/g, "s")
    .replace(/ž/g, "z")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}
