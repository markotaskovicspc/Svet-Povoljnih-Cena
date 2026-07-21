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
import {
  applyRabaluxOverrides,
  isRabaluxFieldLocked,
  parseOverrideFields,
} from "./ownership";
import {
  acquireSyncLease,
  assertFeedBaseline,
  assertSafeMissingShare,
  configuredPositiveInt,
  heartbeatSyncLease,
  isRiskyPriceChange,
  missingGraceSatisfied,
  previousSuccessfulRowCount,
  releaseSyncLease,
  reportCircuitBreaker,
  stableSourceHash,
} from "./safety";

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

export type RabaluxSyncOptions = {
  expectedSourceHash?: string;
  previewRunId?: string;
  requestedById?: string;
  reason?: string;
  allowRiskyPrices?: boolean;
  allowLargeRemoval?: boolean;
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
      sourceHash:
        typeof summary.metadata.sourceHash === "string"
          ? summary.metadata.sourceHash
          : undefined,
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

function assertMinimumFeedRows(kind: string, actual: number, minimum: number) {
  assertFeedBaseline({ kind, actual, absoluteMinimum: minimum });
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
      configuredPositiveInt("RABALUX_MIN_CATALOG_ROWS", 2_000),
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
      configuredPositiveInt("RABALUX_MIN_CATALOG_ROWS", 2_000),
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
    configuredPositiveInt("RABALUX_MIN_STOCK_ROWS", 2_000),
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

export async function syncRabaluxCatalog(options: RabaluxSyncOptions = {}) {
  const supplier = await getSupplier(true);
  const run = await db.importRun.create({
    data: {
      supplierId: supplier.id,
      kind: "CATALOG",
      status: "RUNNING",
      previewRunId: options.previewRunId,
      requestedById: options.requestedById,
      metadata: options.reason ? { reason: options.reason } : undefined,
    },
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
  let leaseAcquired = false;
  try {
    await acquireSyncLease({
      supplierId: supplier.id,
      runId: run.id,
      scope: "CATALOG",
    });
    leaseAcquired = true;
    const catalog = await fetchRabaluxCatalog(supplier);
    summary.read = catalog.items.length;
    const sourceHash = stableSourceHash(catalog.items);
    summary.metadata.sourceHash = sourceHash;
    if (options.expectedSourceHash && options.expectedSourceHash !== sourceHash) {
      throw new Error(
        "Rabalux catalog changed after preview. Create a new preview before execution.",
      );
    }
    summary.metadata.source = catalog.source;
    if (catalog.fallbackReason) {
      summary.metadata.xmlFallbackReason = catalog.fallbackReason;
    }
    const existingProducts = await db.product.findMany({
      where: { supplierId: supplier.id, deletedAt: null },
      select: {
        id: true,
        supplierExternalId: true,
        supplierCatalogMissingCount: true,
        supplierCatalogMissingSince: true,
        isActive: true,
        supplierApprovalStatus: true,
        syncOverrides: true,
      },
    });
    assertFeedBaseline({
      kind: "catalog",
      actual: catalog.items.length,
      absoluteMinimum: configuredPositiveInt("RABALUX_MIN_CATALOG_ROWS", 2_000),
      previousSuccessfulRows: await previousSuccessfulRowCount(
        supplier.id,
        "CATALOG",
        run.id,
      ),
    });
    const seen = new Set(catalog.items.map((item) => item.sourceSku));
    const missing = existingProducts.filter(
      (product) =>
        product.supplierExternalId && !seen.has(product.supplierExternalId),
    );
    assertSafeMissingShare({
      kind: "catalog",
      existing: existingProducts.length,
      missing: missing.length,
      allowLargeRemoval: options.allowLargeRemoval,
    });

    for (let start = 0; start < catalog.items.length; start += ITEM_CONCURRENCY) {
      const batch = catalog.items.slice(start, start + ITEM_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((item) =>
          upsertCatalogItem(supplier, item, run.id, sourceHash, options),
        ),
      );
      results.forEach((result, index) => {
        const item = batch[index];
        if (result.status === "fulfilled") {
          if (result.value.conflict) {
            summary.failed++;
            if (summary.errors.length < MAX_RECORDED_ERRORS) {
              summary.errors.push({
                sourceSku: item.sourceSku,
                message: result.value.conflict,
              });
            }
            return;
          }
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
      if ((start / ITEM_CONCURRENCY) % 25 === 24) {
        await heartbeatSyncLease({
          supplierId: supplier.id,
          runId: run.id,
          scope: "CATALOG",
        });
      }
    }
    const disappearance = await reconcileMissingCatalogProducts({
      supplierId: supplier.id,
      runId: run.id,
      products: missing,
    });
    summary.metadata.missingPending = disappearance.pending;
    summary.metadata.deactivatedAfterGrace = disappearance.deactivated;
    summary.metadata.invalid = catalog.items.filter((item) => !item.valid).length;
    return await closeRun(run.id, summary);
  } catch (error) {
    summary.failed = Math.max(summary.failed, 1);
    summary.errors.push({ message: safeMessage(error) });
    reportCircuitBreaker(error, { runId: run.id, scope: "CATALOG" });
    await closeRun(run.id, summary);
    throw error;
  } finally {
    if (leaseAcquired) {
      await releaseSyncLease({
        supplierId: supplier.id,
        runId: run.id,
        scope: "CATALOG",
      });
    }
  }
}

export async function syncRabaluxCatalogProduct(
  externalSku: string,
  options: RabaluxSyncOptions = {},
) {
  const normalizedSku = externalSku.trim();
  if (!normalizedSku || normalizedSku.length > 120) {
    throw new Error("Rabalux external SKU is invalid.");
  }
  const supplier = await getSupplier(true);
  const run = await db.importRun.create({
    data: {
      supplierId: supplier.id,
      kind: "CATALOG",
      status: "RUNNING",
      requestedById: options.requestedById,
      metadata: {
        reason: options.reason ?? null,
        onlyExternalSku: normalizedSku,
      },
    },
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
    metadata: { onlyExternalSku: normalizedSku },
  };
  let leaseAcquired = false;
  try {
    await acquireSyncLease({
      supplierId: supplier.id,
      runId: run.id,
      scope: "CATALOG",
    });
    leaseAcquired = true;
    const catalog = await fetchRabaluxCatalog(supplier);
    assertFeedBaseline({
      kind: "catalog",
      actual: catalog.items.length,
      absoluteMinimum: configuredPositiveInt("RABALUX_MIN_CATALOG_ROWS", 2_000),
      previousSuccessfulRows: await previousSuccessfulRowCount(
        supplier.id,
        "CATALOG",
        run.id,
      ),
    });
    const sourceHash = stableSourceHash(catalog.items);
    summary.metadata.sourceHash = sourceHash;
    summary.metadata.feedRows = catalog.items.length;
    summary.metadata.source = catalog.source;
    const item = catalog.items.find((candidate) => candidate.sourceSku === normalizedSku);
    if (!item) throw new Error(`Rabalux product ${normalizedSku} is not in the complete feed.`);
    summary.read = 1;
    const result = await upsertCatalogItem(
      supplier,
      item,
      run.id,
      sourceHash,
      options,
    );
    if (result.conflict) throw new Error(result.conflict);
    summary.ok = 1;
    summary[result.created ? "created" : "updated"] = 1;
    summary.mediaQueued = result.mediaQueued ? 1 : 0;
    return await closeRun(run.id, summary);
  } catch (error) {
    summary.failed = 1;
    summary.errors.push({ sourceSku: normalizedSku, message: safeMessage(error) });
    reportCircuitBreaker(error, { runId: run.id, scope: "CATALOG" });
    await closeRun(run.id, summary);
    throw error;
  } finally {
    if (leaseAcquired) {
      await releaseSyncLease({
        supplierId: supplier.id,
        runId: run.id,
        scope: "CATALOG",
      });
    }
  }
}

async function upsertCatalogItem(
  supplier: Supplier,
  item: RabaluxCatalogItem,
  runId: string,
  sourceHash: string,
  options: RabaluxSyncOptions,
) {
  const result = await db.$transaction(async (tx) => {
    const mapping =
      item.category && item.type
        ? await tx.supplierCategoryMapping.findUnique({
            where: {
              supplierId_externalCategory_externalType: {
                supplierId: supplier.id,
                externalCategory: item.category,
                externalType: item.type,
              },
            },
            select: { categoryId: true, enabled: true },
          })
        : null;
    const categoryId = mapping?.enabled ? mapping.categoryId : null;
    const groupId = categoryId && item.type ? await ensureGroup(tx, item.type) : null;
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
        sku: true,
        slug: true,
        name: true,
        barcode: true,
        description: true,
        shortDescription: true,
        colorPrimary: true,
        colorSecondary: true,
        groupId: true,
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
        supplierApprovalStatus: true,
        categories: { select: { categoryId: true } },
        supplierCatalogMissingCount: true,
        lastSupplierSourceHash: true,
        media: {
          orderBy: { order: "asc" },
          select: { sourceUrl: true, kind: true, order: true, syncStatus: true },
        },
        attachments: {
          orderBy: { order: "asc" },
          select: { sourceUrl: true, kind: true, order: true, syncStatus: true },
        },
      },
    });
    if (!existing) {
      const identityConflict = await tx.product.findFirst({
        where: {
          deletedAt: null,
          OR: [
            { sku: item.sku },
            ...(item.barcode ? [{ barcode: item.barcode }] : []),
          ],
        },
        select: { id: true, sku: true, barcode: true, supplierId: true },
      });
      if (identityConflict) {
        const message = `Identity conflict with product ${identityConflict.sku}.`;
        await tx.supplierSyncChange.create({
          data: {
            supplierId: supplier.id,
            importRunId: runId,
            productId: identityConflict.id,
            externalSku: item.sourceSku,
            changeType: "IDENTITY_CONFLICT",
            status: "CONFLICT",
            fieldNames: ["sku", ...(item.barcode ? ["barcode"] : [])],
            before: jsonSnapshot(identityConflict),
            after: jsonSnapshot({ sku: item.sku, barcode: item.barcode }),
            reversible: false,
            reason: message,
          },
        });
        return {
          productId: identityConflict.id,
          created: false,
          mediaQueued: false,
          mediaTarget: null,
          conflict: message,
        };
      }
    }
    const overrideFields = parseOverrideFields(existing?.syncOverrides);
    const itemSourceHash = stableSourceHash(item);
    if (
      existing &&
      existing.lastSupplierSourceHash === itemSourceHash &&
      existing.supplierCatalogMissingCount === 0 &&
      (!categoryId ||
        existing.categories.some((category) => category.categoryId === categoryId) ||
        overrideFields.has("categories") ||
        overrideFields.has("category"))
    ) {
      return {
        productId: existing.id,
        created: false,
        mediaQueued: false,
        mediaTarget: null,
        conflict: null,
      };
    }
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
    const hasApprovedCategory = Boolean(
      categoryId ||
        (existing?.categories.length &&
          (overrideFields.has("categories") || overrideFields.has("category"))),
    );
    const approvalStatus = existing
      ? hasApprovedCategory
        ? existing.supplierApprovalStatus === "PENDING_MAPPING"
          ? "PENDING_APPROVAL"
          : (existing.supplierApprovalStatus ?? "PENDING_APPROVAL")
        : "PENDING_MAPPING"
      : hasApprovedCategory
        ? "PENDING_APPROVAL"
        : "PENDING_MAPPING";
    const activeCandidate =
      item.valid &&
      existing?.articleStatus !== "ARH" &&
      approvalStatus === "APPROVED" &&
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
      supplierApprovalStatus: approvalStatus,
      supplierCatalogMissingCount: 0,
      supplierCatalogMissingSince: null,
      lastSupplierSyncAt: new Date(),
      lastSupplierSourceHash: itemSourceHash,
    };

    let productId: string;
    const beforeSnapshot = existing
      ? jsonSnapshotOmitting(existing, [
          "syncOverrides",
          "supplierCatalogMissingCount",
          "lastSupplierSourceHash",
        ])
      : Prisma.JsonNull;
    const riskyPrice = Boolean(
      existing &&
        !isRabaluxFieldLocked(overrideFields, "pricing") &&
        Number(existing.fullPrice) !== item.fullPrice &&
        isRiskyPriceChange(Number(existing.fullPrice), item.fullPrice),
    );
    if (existing) {
      const updateData = applyRabaluxOverrides(
        data as unknown as Record<string, unknown>,
        overrideFields,
      ) as Prisma.ProductUncheckedUpdateInput;
      delete (updateData as Record<string, unknown>).stock;
      delete (updateData as Record<string, unknown>).supplierStock;
      delete (updateData as Record<string, unknown>).incomingStock;
      if (!categoryId) delete (updateData as Record<string, unknown>).groupId;
      if (!item.valid || (riskyPrice && !options.allowRiskyPrices)) {
        delete (updateData as Record<string, unknown>).fullPrice;
        delete (updateData as Record<string, unknown>).salePrice;
        delete (updateData as Record<string, unknown>).discountPct;
      }
      if (item.valid && !mediaChanged) {
        delete (updateData as Record<string, unknown>).isActive;
      }
      if (overrideFields.has("media")) {
        delete (updateData as Record<string, unknown>).isActive;
      }
      await tx.product.update({ where: { id: existing.id }, data: updateData });
      productId = existing.id;
      if (riskyPrice && !options.allowRiskyPrices) {
        await tx.supplierSyncChange.updateMany({
          where: {
            productId,
            changeType: "PRICE_PROPOSAL",
            status: "PENDING",
          },
          data: {
            status: "SKIPPED",
            reason: "Superseded by a newer supplier price proposal.",
          },
        });
        await tx.supplierSyncChange.create({
          data: {
            supplierId: supplier.id,
            importRunId: runId,
            productId,
            externalSku: item.sourceSku,
            changeType: "PRICE_PROPOSAL",
            status: "PENDING",
            fieldNames: ["fullPrice", "salePrice", "discountPct"],
            before: jsonSnapshot({
              fullPrice: existing.fullPrice,
              salePrice: existing.salePrice,
              discountPct: existing.discountPct,
            }),
            after: jsonSnapshot({
              fullPrice: item.fullPrice,
              salePrice: item.salePrice,
              discountPct: item.discountPct,
            }),
            reason: "Price change exceeds the automatic threshold.",
          },
        });
      }
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
    const after = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: {
        id: true,
        sku: true,
        slug: true,
        name: true,
        barcode: true,
        description: true,
        shortDescription: true,
        colorPrimary: true,
        colorSecondary: true,
        groupId: true,
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
        articleStatus: true,
        supplierApprovalStatus: true,
        categories: { select: { categoryId: true } },
        media: {
          orderBy: { order: "asc" },
          select: { sourceUrl: true, kind: true, order: true, syncStatus: true },
        },
        attachments: {
          orderBy: { order: "asc" },
          select: { sourceUrl: true, kind: true, order: true, syncStatus: true },
        },
      },
    });
    const afterSnapshot = jsonSnapshot(after);
    const fieldNames = changedSnapshotFields(beforeSnapshot, afterSnapshot);
    if (!existing || fieldNames.length) {
      await tx.supplierSyncChange.create({
        data: {
          supplierId: supplier.id,
          importRunId: runId,
          productId,
          externalSku: item.sourceSku,
          changeType: existing ? "UPDATE" : "CREATE",
          status: "APPLIED",
          fieldNames: existing ? fieldNames : ["product"],
          before: beforeSnapshot,
          after: afterSnapshot,
          reversible: true,
          reason: options.reason,
          appliedAt: new Date(),
          reviewedById: options.requestedById,
        },
      });
    }
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
      conflict: null,
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

export async function syncRabaluxStock(options: RabaluxSyncOptions = {}) {
  const supplier = await getSupplier(true);
  const run = await db.importRun.create({
    data: {
      supplierId: supplier.id,
      kind: "STOCK",
      status: "RUNNING",
      previewRunId: options.previewRunId,
      requestedById: options.requestedById,
      metadata: options.reason ? { reason: options.reason } : undefined,
    },
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
  let leaseAcquired = false;
  try {
    await acquireSyncLease({
      supplierId: supplier.id,
      runId: run.id,
      scope: "STOCK",
    });
    leaseAcquired = true;
    const stock = await fetchRabaluxStock(supplier);
    summary.read = stock.length;
    const sourceHash = stableSourceHash(stock);
    summary.metadata.sourceHash = sourceHash;
    if (options.expectedSourceHash && options.expectedSourceHash !== sourceHash) {
      throw new Error(
        "Rabalux stock feed changed after preview. Create a new preview before execution.",
      );
    }
    const products = await db.product.findMany({
      where: { supplierId: supplier.id, deletedAt: null },
      select: {
        id: true,
        supplierExternalId: true,
        supplierStock: true,
        supplierNextArrivalAt: true,
        supplierStockMissingCount: true,
        supplierStockMissingSince: true,
        syncOverrides: true,
        articleStatus: true,
        isDtz: true,
        isActive: true,
        supplierApprovalStatus: true,
      },
    });
    assertFeedBaseline({
      kind: "stock",
      actual: stock.length,
      absoluteMinimum: configuredPositiveInt("RABALUX_MIN_STOCK_ROWS", 2_000),
      previousSuccessfulRows: await previousSuccessfulRowCount(
        supplier.id,
        "STOCK",
        run.id,
      ),
    });
    const productBySourceSku = new Map(
      products
        .filter((product) => product.supplierExternalId)
        .map((product) => [product.supplierExternalId!, product]),
    );
    const seen = new Set(stock.map((item) => item.sourceSku));
    const catalogOnly = products.filter(
      (product) =>
        product.supplierExternalId && !seen.has(product.supplierExternalId),
    );
    assertSafeMissingShare({
      kind: "stock",
      existing: products.length,
      missing: catalogOnly.length,
      allowLargeRemoval: options.allowLargeRemoval,
    });
    const stockOnly: string[] = [];
    for (let start = 0; start < stock.length; start += ITEM_CONCURRENCY) {
      const batch = stock.slice(start, start + ITEM_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const product = productBySourceSku.get(item.sourceSku);
          if (!product) {
            stockOnly.push(item.sourceSku);
            return;
          }
          return updateStockItem(
            supplier.id,
            run.id,
            product,
            item,
            options,
          );
        }),
      );
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          summary.ok++;
          if (result.value) summary.updated++;
        } else {
          summary.failed++;
          if (summary.errors.length < MAX_RECORDED_ERRORS) {
            summary.errors.push({
              sourceSku: batch[index].sourceSku,
              message: safeMessage(result.reason),
            });
          }
        }
      });
      if ((start / ITEM_CONCURRENCY) % 25 === 24) {
        await heartbeatSyncLease({
          supplierId: supplier.id,
          runId: run.id,
          scope: "STOCK",
        });
      }
    }
    const missingResult = await reconcileMissingStockProducts({
      supplierId: supplier.id,
      runId: run.id,
      products: catalogOnly,
      reason: options.reason,
      reviewedById: options.requestedById,
    });
    summary.metadata.stockOnly = stockOnly.sort();
    summary.metadata.catalogOnly = catalogOnly
      .map((product) => product.supplierExternalId)
      .filter(Boolean)
      .sort();
    summary.metadata.missingPending = missingResult.pending;
    summary.metadata.zeroedAfterGrace = missingResult.zeroed;
    summary.metadata.restricted = stock.filter((item) => item.restricted).length;
    summary.metadata.outgoing = stock.filter((item) => item.outgoing).length;
    return await closeRun(run.id, summary);
  } catch (error) {
    summary.failed = Math.max(summary.failed, 1);
    summary.errors.push({ message: safeMessage(error) });
    reportCircuitBreaker(error, { runId: run.id, scope: "STOCK" });
    await closeRun(run.id, summary);
    throw error;
  } finally {
    if (leaseAcquired) {
      await releaseSyncLease({
        supplierId: supplier.id,
        runId: run.id,
        scope: "STOCK",
      });
    }
  }
}

async function updateStockItem(
  supplierId: string,
  runId: string,
  product: {
    id: string;
    supplierExternalId: string | null;
    supplierStock: number | null;
    supplierNextArrivalAt: Date | null;
    supplierStockMissingCount: number;
    supplierStockMissingSince: Date | null;
    syncOverrides: Prisma.JsonValue | null;
    articleStatus: "SP" | "IT" | "DTZ" | "DOB" | "ARH" | "UZ";
    isDtz: boolean;
    isActive: boolean;
    supplierApprovalStatus:
      | "PENDING_MAPPING"
      | "PENDING_APPROVAL"
      | "APPROVED"
      | "REJECTED"
      | null;
  },
  item: RabaluxStockItem,
  options: RabaluxSyncOptions,
) {
  const nextStatus = item.restricted ? "ARH" : item.outgoing ? "DTZ" : "SP";
  return db.$transaction(async (tx) => {
    const overrideFields = parseOverrideFields(product.syncOverrides);
    const stockLocked = isRabaluxFieldLocked(overrideFields, "stock");
    const flagsLocked = isRabaluxFieldLocked(overrideFields, "flags");
    const stockChanged =
      (product.supplierStock ?? 0) !== item.stock ||
      product.supplierNextArrivalAt?.getTime() !== item.nextArrivalAt?.getTime();
    if (stockChanged && !stockLocked) {
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
    const before = jsonSnapshot({
      supplierStock: product.supplierStock,
      supplierNextArrivalAt: product.supplierNextArrivalAt,
      articleStatus: product.articleStatus,
      isDtz: product.isDtz,
      isActive: product.isActive,
    });
    await tx.product.update({
      where: { id: product.id },
      data: {
        ...(!stockLocked
          ? {
              supplierStock: item.stock,
              supplierNextArrivalAt: item.nextArrivalAt,
            }
          : {}),
        ...(!flagsLocked
          ? {
              isDtz: item.outgoing,
              articleStatus: nextStatus,
              ...(item.restricted ? { isActive: false } : {}),
            }
          : {}),
        supplierStockMissingCount: 0,
        supplierStockMissingSince: null,
        lastSupplierSyncAt: new Date(),
      },
    });
    if (!item.restricted && !flagsLocked) {
      const readiness = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        select: {
          fullPrice: true,
          supplierApprovalStatus: true,
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
            readiness.supplierApprovalStatus === "APPROVED" &&
            Number(readiness.fullPrice) > 0 &&
            readiness.categories.length > 0 &&
            readiness.media.length > 0,
        },
      });
    }
    const finalProduct = await tx.product.findUniqueOrThrow({
      where: { id: product.id },
      select: {
        supplierStock: true,
        supplierNextArrivalAt: true,
        articleStatus: true,
        isDtz: true,
        isActive: true,
      },
    });
    const after = jsonSnapshot(finalProduct);
    const fieldNames = changedSnapshotFields(before, after);
    if (fieldNames.length) {
      await tx.supplierSyncChange.create({
        data: {
          supplierId,
          importRunId: runId,
          productId: product.id,
          externalSku: item.sourceSku,
          changeType: "STOCK_UPDATE",
          status: "APPLIED",
          fieldNames,
          before,
          after,
          appliedAt: new Date(),
          reason: options.reason,
          reviewedById: options.requestedById,
        },
      });
    }
    return fieldNames.length > 0;
  });
}

async function reconcileMissingCatalogProducts(args: {
  supplierId: string;
  runId: string;
  products: Array<{
    id: string;
    supplierExternalId: string | null;
    supplierCatalogMissingCount: number;
    supplierCatalogMissingSince: Date | null;
    isActive: boolean;
    supplierApprovalStatus:
      | "PENDING_MAPPING"
      | "PENDING_APPROVAL"
      | "APPROVED"
      | "REJECTED"
      | null;
    syncOverrides: Prisma.JsonValue | null;
  }>;
}) {
  const now = new Date();
  const confirmations = configuredPositiveInt(
    "RABALUX_CATALOG_MISSING_CONFIRMATIONS",
    2,
  );
  const graceHours = configuredPositiveInt("RABALUX_CATALOG_MISSING_GRACE_HOURS", 20);
  let pending = 0;
  let deactivated = 0;
  for (let start = 0; start < args.products.length; start += ITEM_CONCURRENCY) {
    await Promise.all(
      args.products.slice(start, start + ITEM_CONCURRENCY).map(async (product) => {
        const nextCount = product.supplierCatalogMissingCount + 1;
        const firstMissingAt = product.supplierCatalogMissingSince ?? now;
        const flagsLocked = isRabaluxFieldLocked(
          parseOverrideFields(product.syncOverrides),
          "flags",
        );
        const shouldDeactivate =
          !flagsLocked &&
          missingGraceSatisfied({
            nextCount,
            firstMissingAt,
            now,
            confirmations,
            graceMs: graceHours * 60 * 60 * 1_000,
          });
        await db.$transaction(async (tx) => {
          await tx.product.update({
            where: { id: product.id },
            data: {
              supplierCatalogMissingCount: nextCount,
              supplierCatalogMissingSince: firstMissingAt,
              ...(shouldDeactivate
                ? {
                    isActive: false,
                    supplierApprovalStatus: "PENDING_APPROVAL" as const,
                  }
                : {}),
            },
          });
          if (shouldDeactivate && product.isActive) {
            await tx.supplierSyncChange.create({
              data: {
                supplierId: args.supplierId,
                importRunId: args.runId,
                productId: product.id,
                externalSku: product.supplierExternalId!,
                changeType: "DEACTIVATE_MISSING",
                status: "APPLIED",
                fieldNames: ["isActive", "supplierApprovalStatus"],
                before: jsonSnapshot({
                  isActive: product.isActive,
                  supplierApprovalStatus: product.supplierApprovalStatus,
                }),
                after: jsonSnapshot({
                  isActive: false,
                  supplierApprovalStatus: "PENDING_APPROVAL",
                }),
                appliedAt: now,
                reason: `Missing from ${nextCount} complete catalog feeds after ${graceHours}h grace.`,
              },
            });
          }
        });
        if (shouldDeactivate) deactivated++;
        else pending++;
      }),
    );
  }
  return { pending, deactivated };
}

async function reconcileMissingStockProducts(args: {
  supplierId: string;
  runId: string;
  products: Array<{
    id: string;
    supplierExternalId: string | null;
    supplierStock: number | null;
    supplierNextArrivalAt: Date | null;
    supplierStockMissingCount: number;
    supplierStockMissingSince: Date | null;
    syncOverrides: Prisma.JsonValue | null;
  }>;
  reason?: string;
  reviewedById?: string;
}) {
  const now = new Date();
  const confirmations = configuredPositiveInt(
    "RABALUX_STOCK_MISSING_CONFIRMATIONS",
    3,
  );
  const graceMinutes = configuredPositiveInt("RABALUX_STOCK_MISSING_GRACE_MINUTES", 30);
  let pending = 0;
  let zeroed = 0;
  for (let start = 0; start < args.products.length; start += ITEM_CONCURRENCY) {
    await Promise.all(
      args.products.slice(start, start + ITEM_CONCURRENCY).map(async (product) => {
        const nextCount = product.supplierStockMissingCount + 1;
        const firstMissingAt = product.supplierStockMissingSince ?? now;
        const stockLocked = isRabaluxFieldLocked(
          parseOverrideFields(product.syncOverrides),
          "stock",
        );
        const shouldZero =
          !stockLocked &&
          missingGraceSatisfied({
            nextCount,
            firstMissingAt,
            now,
            confirmations,
            graceMs: graceMinutes * 60 * 1_000,
          });
        await db.$transaction(async (tx) => {
          if (shouldZero && (product.supplierStock ?? 0) !== 0) {
            await tx.supplierStockSnapshot.create({
              data: {
                supplierId: args.supplierId,
                productId: product.id,
                externalSku: product.supplierExternalId!,
                stock: 0,
                incomingStock: 0,
              },
            });
          }
          await tx.product.update({
            where: { id: product.id },
            data: {
              supplierStockMissingCount: nextCount,
              supplierStockMissingSince: firstMissingAt,
              ...(shouldZero
                ? { supplierStock: 0, supplierNextArrivalAt: null }
                : {}),
            },
          });
          if (shouldZero && (product.supplierStock ?? 0) !== 0) {
            await tx.supplierSyncChange.create({
              data: {
                supplierId: args.supplierId,
                importRunId: args.runId,
                productId: product.id,
                externalSku: product.supplierExternalId!,
                changeType: "ZERO_MISSING_STOCK",
                status: "APPLIED",
                fieldNames: ["supplierStock", "supplierNextArrivalAt"],
                before: jsonSnapshot({
                  supplierStock: product.supplierStock,
                  supplierNextArrivalAt: product.supplierNextArrivalAt,
                }),
                after: jsonSnapshot({
                  supplierStock: 0,
                  supplierNextArrivalAt: null,
                }),
                appliedAt: now,
                reason:
                  args.reason ??
                  `Missing from ${nextCount} complete stock feeds after ${graceMinutes}m grace.`,
                reviewedById: args.reviewedById,
              },
            });
          }
        });
        if (shouldZero) zeroed++;
        else pending++;
      }),
    );
  }
  return { pending, zeroed };
}

function jsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonSnapshotOmitting(
  value: Record<string, unknown>,
  omitted: string[],
): Prisma.InputJsonValue {
  return jsonSnapshot(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !omitted.includes(key)),
    ),
  );
}

function changedSnapshotFields(before: unknown, after: unknown) {
  const left =
    before && typeof before === "object" && !Array.isArray(before)
      ? (before as Record<string, unknown>)
      : {};
  const right =
    after && typeof after === "object" && !Array.isArray(after)
      ? (after as Record<string, unknown>)
      : {};
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
    (key) => stableSourceHash(left[key]) !== stableSourceHash(right[key]),
  );
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
