import "server-only";

import { Prisma, type Supplier } from "@prisma/client";
import { db } from "@/lib/db";
import { parseOverrideFields } from "./ownership";
import { isRiskyPriceChange, stableSourceHash } from "./safety";
import { fetchRabaluxCatalog, fetchRabaluxStock } from "./sync";
import type { RabaluxSyncTarget } from "./admin-sync";
import type { RabaluxCatalogItem } from "./types";

export type RabaluxPreviewSummary = {
  source: "XML" | "CSV" | "DATABASE";
  sourceHash: string;
  catalogRows: number;
  stockRows: number;
  catalogUnique: number;
  stockUnique: number;
  invalidPrice: number;
  catalogOnly: string[];
  stockOnly: string[];
  videos: number;
  manuals: number;
  energyLabels: number;
  imageAssets: number;
  diff: {
    creates: number;
    updates: number;
    priceProposals: number;
    deactivations: number;
    stockUpdates: number;
    missingMappings: number;
    identityConflicts: number;
    mediaPending: number;
    unchanged: number;
  };
  samples: Array<{
    externalSku: string;
    changeType: string;
    fields: string[];
  }>;
};

type ChangeInput = Prisma.SupplierSyncChangeCreateManyInput;

const EMPTY_DIFF: RabaluxPreviewSummary["diff"] = {
  creates: 0,
  updates: 0,
  priceProposals: 0,
  deactivations: 0,
  stockUpdates: 0,
  missingMappings: 0,
  identityConflicts: 0,
  mediaPending: 0,
  unchanged: 0,
};

export async function prepareRabaluxPreview(args: {
  supplier: Supplier;
  target: RabaluxSyncTarget;
  runId: string;
}) {
  const prepared =
    args.target === "catalog"
      ? await prepareCatalogPreview(args.supplier, args.runId)
      : args.target === "stock"
        ? await prepareStockPreview(args.supplier, args.runId)
        : await prepareMediaPreview(args.supplier, args.runId);
  for (let start = 0; start < prepared.changes.length; start += 500) {
    await db.supplierSyncChange.createMany({
      data: prepared.changes.slice(start, start + 500),
    });
  }
  return prepared.summary;
}

async function prepareCatalogPreview(supplier: Supplier, runId: string) {
  const catalog = await fetchRabaluxCatalog(supplier);
  const products = await db.product.findMany({
    where: { supplierId: supplier.id, deletedAt: null },
    select: {
      id: true,
      supplierExternalId: true,
      sku: true,
      barcode: true,
      name: true,
      description: true,
      shortDescription: true,
      colorPrimary: true,
      colorSecondary: true,
      groupId: true,
      group: { select: { name: true } },
      widthCm: true,
      depthCm: true,
      heightCm: true,
      weightKg: true,
      grossWeightKg: true,
      packWidthCm: true,
      packDepthCm: true,
      packHeightCm: true,
      packGrossWeightKg: true,
      fullPrice: true,
      salePrice: true,
      discountPct: true,
      technicalSpecs: true,
      warrantyYears: true,
      countryOfOrigin: true,
      hsCode: true,
      isNew: true,
      isActive: true,
      syncOverrides: true,
      categories: { select: { categoryId: true } },
      media: {
        orderBy: { order: "asc" },
        select: { sourceUrl: true, kind: true, order: true },
      },
      attachments: {
        orderBy: { order: "asc" },
        select: { sourceUrl: true, kind: true, order: true },
      },
    },
  });
  const mappings = await db.supplierCategoryMapping.findMany({
    where: { supplierId: supplier.id, enabled: true },
    select: { externalCategory: true, externalType: true, categoryId: true },
  });
  const mappingByPair = new Map(
    mappings.map((mapping) => [
      categoryKey(mapping.externalCategory, mapping.externalType),
      mapping.categoryId,
    ]),
  );
  const productByExternal = new Map(
    products
      .filter((product) => product.supplierExternalId)
      .map((product) => [product.supplierExternalId!, product]),
  );
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const productByBarcode = new Map(
    products
      .filter((product) => product.barcode)
      .map((product) => [product.barcode!, product]),
  );
  const diff = { ...EMPTY_DIFF };
  const changes: ChangeInput[] = [];
  const seen = new Set<string>();

  for (const item of catalog.items) {
    seen.add(item.sourceSku);
    const existing = productByExternal.get(item.sourceSku);
    const mappingId =
      item.category && item.type
        ? mappingByPair.get(categoryKey(item.category, item.type))
        : undefined;
    if (!existing) {
      const conflict =
        productBySku.get(item.sku) ??
        (item.barcode ? productByBarcode.get(item.barcode) : undefined);
      if (conflict) {
        diff.identityConflicts++;
        changes.push(
          change({
            supplierId: supplier.id,
            runId,
            productId: conflict.id,
            externalSku: item.sourceSku,
            changeType: "IDENTITY_CONFLICT",
            status: "CONFLICT",
            fields: ["sku", ...(item.barcode ? ["barcode"] : [])],
            before: { sku: conflict.sku, barcode: conflict.barcode },
            after: { sku: item.sku, barcode: item.barcode },
            reversible: false,
          }),
        );
        continue;
      }
      diff.creates++;
      changes.push(
        change({
          supplierId: supplier.id,
          runId,
          externalSku: item.sourceSku,
          changeType: "CREATE",
          fields: ["product"],
          before: null,
          after: catalogItemSnapshot(item, mappingId),
        }),
      );
    } else {
      const before = existingCatalogSnapshot(existing);
      const after = catalogItemSnapshot(item, mappingId);
      const locked = parseOverrideFields(existing.syncOverrides);
      const fields = changedFields(before, after).filter(
        (field) => !fieldIsLocked(field, locked),
      );
      const riskyPrice =
        fields.includes("fullPrice") &&
        isRiskyPriceChange(Number(existing.fullPrice), item.fullPrice);
      const updateFields = riskyPrice
        ? fields.filter(
            (field) => !["fullPrice", "salePrice", "discountPct"].includes(field),
          )
        : fields;
      if (updateFields.length) {
        diff.updates++;
        changes.push(
          change({
            supplierId: supplier.id,
            runId,
            productId: existing.id,
            externalSku: item.sourceSku,
            changeType: "UPDATE",
            fields: updateFields,
            before,
            after,
          }),
        );
      } else if (!riskyPrice) {
        diff.unchanged++;
      }
      if (riskyPrice) {
        diff.priceProposals++;
        changes.push(
          change({
            supplierId: supplier.id,
            runId,
            productId: existing.id,
            externalSku: item.sourceSku,
            changeType: "PRICE_PROPOSAL",
            fields: ["fullPrice", "salePrice", "discountPct"],
            before: {
              fullPrice: Number(existing.fullPrice),
              salePrice: existing.salePrice == null ? null : Number(existing.salePrice),
              discountPct: existing.discountPct,
            },
            after: {
              fullPrice: item.fullPrice,
              salePrice: item.salePrice,
              discountPct: item.discountPct,
            },
          }),
        );
      }
    }
    if (!mappingId) {
      diff.missingMappings++;
      changes.push(
        change({
          supplierId: supplier.id,
          runId,
          productId: existing?.id,
          externalSku: item.sourceSku,
          changeType: "MAPPING_REQUIRED",
          status: "CONFLICT",
          fields: ["categories"],
          before: existing?.categories ?? null,
          after: { category: item.category, type: item.type },
          reversible: false,
        }),
      );
    }
  }

  const missing = products.filter(
    (product) =>
      product.supplierExternalId && !seen.has(product.supplierExternalId),
  );
  for (const product of missing) {
    diff.deactivations++;
    changes.push(
      change({
        supplierId: supplier.id,
        runId,
        productId: product.id,
        externalSku: product.supplierExternalId!,
        changeType: "DEACTIVATE_MISSING",
        fields: ["isActive"],
        before: { isActive: product.isActive },
        after: { isActive: false, graceRequired: true },
      }),
    );
  }

  return {
    changes,
    summary: previewSummary({
      source: catalog.source,
      sourceHash: stableSourceHash(catalog.items),
      catalog: catalog.items,
      stockRows: 0,
      catalogOnly: missing.map((product) => product.supplierExternalId!),
      stockOnly: [],
      diff,
      changes,
    }),
  };
}

async function prepareStockPreview(supplier: Supplier, runId: string) {
  const stock = await fetchRabaluxStock(supplier);
  const products = await db.product.findMany({
    where: { supplierId: supplier.id, deletedAt: null },
    select: {
      id: true,
      supplierExternalId: true,
      supplierStock: true,
      supplierNextArrivalAt: true,
      articleStatus: true,
      isDtz: true,
      syncOverrides: true,
    },
  });
  const productByExternal = new Map(
    products
      .filter((product) => product.supplierExternalId)
      .map((product) => [product.supplierExternalId!, product]),
  );
  const diff = { ...EMPTY_DIFF };
  const changes: ChangeInput[] = [];
  const seen = new Set<string>();
  const stockOnly: string[] = [];
  for (const item of stock) {
    seen.add(item.sourceSku);
    const product = productByExternal.get(item.sourceSku);
    if (!product) {
      stockOnly.push(item.sourceSku);
      continue;
    }
    const before = {
      supplierStock: product.supplierStock,
      supplierNextArrivalAt: product.supplierNextArrivalAt?.toISOString() ?? null,
      articleStatus: product.articleStatus,
      isDtz: product.isDtz,
    };
    const after = {
      supplierStock: item.stock,
      supplierNextArrivalAt: item.nextArrivalAt?.toISOString() ?? null,
      articleStatus: item.restricted ? "ARH" : item.outgoing ? "DTZ" : "SP",
      isDtz: item.outgoing,
    };
    const locked = parseOverrideFields(product.syncOverrides);
    const fields = changedFields(before, after).filter(
      (field) => !fieldIsLocked(field, locked),
    );
    if (!fields.length) {
      diff.unchanged++;
      continue;
    }
    diff.stockUpdates++;
    changes.push(
      change({
        supplierId: supplier.id,
        runId,
        productId: product.id,
        externalSku: item.sourceSku,
        changeType: "STOCK_UPDATE",
        fields,
        before,
        after,
      }),
    );
  }
  const catalogOnly = products.filter(
    (product) =>
      product.supplierExternalId && !seen.has(product.supplierExternalId),
  );
  for (const product of catalogOnly) {
    diff.stockUpdates++;
    changes.push(
      change({
        supplierId: supplier.id,
        runId,
        productId: product.id,
        externalSku: product.supplierExternalId!,
        changeType: "ZERO_MISSING_STOCK",
        fields: ["supplierStock", "supplierNextArrivalAt"],
        before: {
          supplierStock: product.supplierStock,
          supplierNextArrivalAt: product.supplierNextArrivalAt?.toISOString() ?? null,
        },
        after: { supplierStock: 0, supplierNextArrivalAt: null, graceRequired: true },
      }),
    );
  }
  return {
    changes,
    summary: previewSummary({
      source: "CSV",
      sourceHash: stableSourceHash(stock),
      catalog: [],
      stockRows: stock.length,
      catalogOnly: catalogOnly.map((product) => product.supplierExternalId!),
      stockOnly,
      diff,
      changes,
    }),
  };
}

async function prepareMediaPreview(supplier: Supplier, runId: string) {
  const [media, attachments] = await Promise.all([
    db.productMedia.findMany({
      where: {
        product: { supplierId: supplier.id },
        syncStatus: { not: "READY" },
      },
      select: { id: true, productId: true, sourceUrl: true, kind: true },
      orderBy: { id: "asc" },
    }),
    db.productAttachment.findMany({
      where: {
        product: { supplierId: supplier.id },
        syncStatus: { not: "READY" },
      },
      select: { id: true, productId: true, sourceUrl: true, kind: true },
      orderBy: { updatedAt: "asc" },
    }),
  ]);
  const rows = [...media, ...attachments];
  const diff = { ...EMPTY_DIFF, mediaPending: rows.length };
  const changes = rows.map((asset) =>
    change({
      supplierId: supplier.id,
      runId,
      productId: asset.productId,
      externalSku: asset.id,
      changeType: "MEDIA_RETRY",
      fields: ["syncStatus"],
      before: { syncStatus: "PENDING_OR_FAILED" },
      after: { syncStatus: "QUEUED", sourceUrl: asset.sourceUrl },
      reversible: false,
    }),
  );
  return {
    changes,
    summary: previewSummary({
      source: "DATABASE",
      sourceHash: stableSourceHash(rows.map(({ id }) => id)),
      catalog: [],
      stockRows: 0,
      catalogOnly: [],
      stockOnly: [],
      diff,
      changes,
      media,
      attachments,
    }),
  };
}

function previewSummary(args: {
  source: RabaluxPreviewSummary["source"];
  sourceHash: string;
  catalog: RabaluxCatalogItem[];
  stockRows: number;
  catalogOnly: string[];
  stockOnly: string[];
  diff: RabaluxPreviewSummary["diff"];
  changes: ChangeInput[];
  media?: Array<{ kind: string }>;
  attachments?: Array<{ kind: string }>;
}): RabaluxPreviewSummary {
  const media = args.media ?? args.catalog.flatMap((item) => item.media);
  const attachments =
    args.attachments ?? args.catalog.flatMap((item) => item.attachments);
  return {
    source: args.source,
    sourceHash: args.sourceHash,
    catalogRows: args.catalog.length,
    stockRows: args.stockRows,
    catalogUnique: new Set(args.catalog.map((item) => item.sourceSku)).size,
    stockUnique: args.stockRows,
    invalidPrice: args.catalog.filter((item) => item.fullPrice <= 0).length,
    catalogOnly: args.catalogOnly.slice(0, 100),
    stockOnly: args.stockOnly.slice(0, 100),
    videos: media.filter((asset) => asset.kind !== "IMAGE").length,
    manuals: attachments.filter((asset) => asset.kind === "MANUAL").length,
    energyLabels: attachments.filter((asset) => asset.kind === "ENERGY_LABEL").length,
    imageAssets: media.filter((asset) => asset.kind === "IMAGE").length,
    diff: args.diff,
    samples: args.changes.slice(0, 30).map((item) => ({
      externalSku: item.externalSku,
      changeType: item.changeType,
      fields: Array.isArray(item.fieldNames) ? item.fieldNames : [],
    })),
  };
}

function change(args: {
  supplierId: string;
  runId: string;
  productId?: string;
  externalSku: string;
  changeType: string;
  status?: "PREVIEW" | "CONFLICT";
  fields: string[];
  before: unknown;
  after: unknown;
  reversible?: boolean;
}): ChangeInput {
  return {
    supplierId: args.supplierId,
    importRunId: args.runId,
    productId: args.productId,
    externalSku: args.externalSku,
    changeType: args.changeType,
    status: args.status ?? "PREVIEW",
    fieldNames: args.fields,
    before: json(args.before),
    after: json(args.after),
    reversible: args.reversible ?? true,
  };
}

function catalogItemSnapshot(item: RabaluxCatalogItem, categoryId?: string) {
  return {
    sku: item.sku,
    barcode: item.barcode,
    name: item.name,
    description: item.description,
    shortDescription:
      item.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320) ||
      null,
    colorPrimary: item.colorPrimary,
    colorSecondary: item.colorSecondary,
    groupName: item.type,
    widthCm: item.widthCm,
    depthCm: item.depthCm,
    heightCm: item.heightCm,
    weightKg: item.weightKg,
    grossWeightKg: item.grossWeightKg,
    packWidthCm: item.packWidthCm,
    packDepthCm: item.packDepthCm,
    packHeightCm: item.packHeightCm,
    packGrossWeightKg: item.packGrossWeightKg,
    fullPrice: item.fullPrice,
    salePrice: item.salePrice,
    discountPct: item.discountPct,
    technicalSpecs: item.technicalSpecs,
    warrantyYears: item.warrantyYears,
    countryOfOrigin: item.countryOfOrigin,
    hsCode: item.hsCode,
    isNew: item.isNew,
    categories: categoryId ? [categoryId] : [],
    media: item.media.map(({ sourceUrl, kind, order }) => ({ sourceUrl, kind, order })),
    attachments: item.attachments.map(({ sourceUrl, kind, order }) => ({
      sourceUrl,
      kind,
      order,
    })),
  };
}

function existingCatalogSnapshot(product: Parameters<typeof catalogProductShape>[0]) {
  return catalogProductShape(product);
}

function catalogProductShape(product: {
  sku: string;
  barcode: string | null;
  name: string;
  description: string;
  shortDescription: string | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  group: { name: string } | null;
  widthCm: Prisma.Decimal | null;
  depthCm: Prisma.Decimal | null;
  heightCm: Prisma.Decimal | null;
  weightKg: Prisma.Decimal | null;
  grossWeightKg: Prisma.Decimal | null;
  packWidthCm: Prisma.Decimal | null;
  packDepthCm: Prisma.Decimal | null;
  packHeightCm: Prisma.Decimal | null;
  packGrossWeightKg: Prisma.Decimal | null;
  fullPrice: Prisma.Decimal;
  salePrice: Prisma.Decimal | null;
  discountPct: number | null;
  technicalSpecs: Prisma.JsonValue | null;
  warrantyYears: number | null;
  countryOfOrigin: string | null;
  hsCode: string | null;
  isNew: boolean;
  categories: Array<{ categoryId: string }>;
  media: Array<{ sourceUrl: string | null; kind: string; order: number }>;
  attachments: Array<{ sourceUrl: string | null; kind: string; order: number }>;
}) {
  return {
    sku: product.sku,
    barcode: product.barcode,
    name: product.name,
    description: product.description,
    shortDescription: product.shortDescription,
    colorPrimary: product.colorPrimary,
    colorSecondary: product.colorSecondary,
    groupName: product.group?.name ?? null,
    widthCm: decimalNumber(product.widthCm),
    depthCm: decimalNumber(product.depthCm),
    heightCm: decimalNumber(product.heightCm),
    weightKg: decimalNumber(product.weightKg),
    grossWeightKg: decimalNumber(product.grossWeightKg),
    packWidthCm: decimalNumber(product.packWidthCm),
    packDepthCm: decimalNumber(product.packDepthCm),
    packHeightCm: decimalNumber(product.packHeightCm),
    packGrossWeightKg: decimalNumber(product.packGrossWeightKg),
    fullPrice: Number(product.fullPrice),
    salePrice: decimalNumber(product.salePrice),
    discountPct: product.discountPct,
    technicalSpecs: product.technicalSpecs,
    warrantyYears: product.warrantyYears,
    countryOfOrigin: product.countryOfOrigin,
    hsCode: product.hsCode,
    isNew: product.isNew,
    categories: product.categories.map(({ categoryId }) => categoryId).sort(),
    media: product.media.map(({ sourceUrl, kind, order }) => ({ sourceUrl, kind, order })),
    attachments: product.attachments.map(({ sourceUrl, kind, order }) => ({
      sourceUrl,
      kind,
      order,
    })),
  };
}

function decimalNumber(value: Prisma.Decimal | null) {
  return value == null ? null : Number(value);
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => stableSourceHash(before[key]) !== stableSourceHash(after[key]),
  );
}

function fieldIsLocked(field: string, locked: ReturnType<typeof parseOverrideFields>) {
  if (["sku", "barcode"].includes(field)) return locked.has("identity");
  if (field === "name") return locked.has("name") || locked.has("identity");
  if (["description", "shortDescription"].includes(field)) return locked.has("description");
  if (["fullPrice", "salePrice", "discountPct"].includes(field)) {
    return locked.has("pricing") || locked.has("price");
  }
  if (field === "categories") return locked.has("categories") || locked.has("category");
  if (field === "media") return locked.has("media");
  if (field === "attachments") return locked.has("attachments");
  if (field === "groupName") return locked.has("grouping");
  if (field.startsWith("supplier") || field === "articleStatus") return locked.has("stock");
  if (["isDtz", "isActive", "isNew"].includes(field)) return locked.has("flags");
  if (field.toLowerCase().includes("cm") || field.toLowerCase().includes("kg")) {
    return locked.has("dimensions");
  }
  if (
    [
      "technicalSpecs",
      "warrantyYears",
      "countryOfOrigin",
      "hsCode",
      "colorPrimary",
      "colorSecondary",
    ].includes(field)
  ) {
    return locked.has("specifications");
  }
  return false;
}

function categoryKey(category: string, type: string) {
  return `${category}\u0000${type}`;
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null
    ? Prisma.JsonNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}
