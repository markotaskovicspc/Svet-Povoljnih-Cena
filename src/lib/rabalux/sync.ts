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
import { rabaluxMediaJobIdempotencyKey } from "./media-upload";
import type {
  RabaluxCatalogItem,
  RabaluxStockItem,
} from "./types";
import {
  applyRabaluxOverrides,
  isRabaluxFieldLocked,
  parseOverrideFields,
} from "./ownership";
import { omitSupplierProductNewnessUpdates } from "@/lib/product-newness";
import {
  RABALUX_PUBLIC_STOCK_THRESHOLD,
  isRabaluxStockFresh,
  resolveRabaluxAvailability,
} from "./availability";
import {
  isCommittedRabaluxWeeklyStockMetadata,
  RABALUX_WEEKLY_STOCK_SOURCE_TYPE,
  shouldReconcileMissingCatalogProducts,
} from "./weekly-stock-policy";
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
import {
  activeRetailPriceEntryWhere,
  upsertActiveRetailPrice,
} from "@/lib/pricing/retail-price-write.server";
import { preserveExistingProductDescriptions } from "@/lib/product-descriptions";
import { propagateProductFamilySharedData } from "@/lib/product-family.server";
import { RABALUX_PICTOGRAMS } from "./pictograms";
import {
  assertRabaluxSerbiaStockSource,
  isRabaluxSerbiaStockPresent,
  isRabaluxSerbiaWebStockAvailable,
  rabaluxStockItemsBySku,
  selectRabaluxSerbiaStockCatalog,
} from "./serbia-stock";

const MAX_RECORDED_ERRORS = 50;
const ITEM_CONCURRENCY = 6;
const RABALUX_CATALOG_MODEL_VERSION = 2;
const RABALUX_PICTOGRAM_CODES: ReadonlySet<string> = new Set(
  RABALUX_PICTOGRAMS.map((definition) => definition.code),
);

type RabaluxPictogramIdMap = ReadonlyMap<string, string>;

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

async function ensureRabaluxPictogramDefinitions() {
  return db.$transaction(async (tx) => {
    const definitions = new Map<string, string>();
    for (const definition of RABALUX_PICTOGRAMS) {
      const pictogram = await tx.pictogram.upsert({
        where: { code: definition.code },
        create: {
          code: definition.code,
          label: definition.label,
          iconUrl: definition.iconUrl,
        },
        update: {
          label: definition.label,
          iconUrl: definition.iconUrl,
        },
        select: { id: true },
      });
      definitions.set(definition.code, pictogram.id);
    }
    return definitions;
  });
}

async function syncExistingRabaluxPictogramAssignments(
  supplierId: string,
  items: RabaluxCatalogItem[],
  pictogramIdsByCode: RabaluxPictogramIdMap,
) {
  const itemBySourceSku = new Map(items.map((item) => [item.sourceSku, item]));
  const products = await db.product.findMany({
    where: { supplierId, deletedAt: null },
    select: {
      id: true,
      supplierExternalId: true,
      syncOverrides: true,
      familyMembership: {
        select: {
          family: {
            select: {
              primaryProduct: {
                select: { supplierExternalId: true, syncOverrides: true },
              },
            },
          },
        },
      },
    },
  });
  const managedPictogramIds = [...pictogramIdsByCode.values()];
  const targetProductIds: string[] = [];
  const assignments: Array<{ productId: string; pictogramId: string }> = [];

  for (const product of products) {
    const primaryProduct = product.familyMembership?.family.primaryProduct;
    if (
      parseOverrideFields(product.syncOverrides).has("pictograms") ||
      parseOverrideFields(primaryProduct?.syncOverrides).has("pictograms")
    ) {
      continue;
    }
    const sourceSku =
      primaryProduct?.supplierExternalId ?? product.supplierExternalId;
    if (!sourceSku) continue;
    const item = itemBySourceSku.get(sourceSku);
    if (!item) continue;
    targetProductIds.push(product.id);
    for (const code of item.pictogramCodes) {
      const pictogramId = pictogramIdsByCode.get(code);
      if (pictogramId) assignments.push({ productId: product.id, pictogramId });
    }
  }

  if (!targetProductIds.length || !managedPictogramIds.length) {
    return { products: 0, assignments: 0 };
  }
  await db.$transaction(async (tx) => {
    await tx.productPictogram.deleteMany({
      where: {
        productId: { in: targetProductIds },
        pictogramId: { in: managedPictogramIds },
      },
    });
    if (assignments.length) {
      await tx.productPictogram.createMany({
        data: assignments,
        skipDuplicates: true,
      });
    }
  });
  return { products: targetProductIds.length, assignments: assignments.length };
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
  assertRabaluxSerbiaStockSource(supplier);
  if (!supplier.stockFeedUrl) throw new Error("Rabalux Serbia stock feed URL is missing.");
  const credentials = rabaluxStockCredentials(supplier);
  if (!credentials.user || !credentials.pass) {
    throw new Error("Rabalux stock API user or API key is not configured.");
  }
  const raw = await fetchRabaluxFeed(
    supplier.stockFeedUrl,
    credentials,
    "text/csv, text/plain, */*;q=0.5",
  );
  const items = parseRabaluxStockCsv(raw);
  rabaluxStockItemsBySku(items);
  assertMinimumFeedRows(
    "Serbia stock",
    items.length,
    configuredPositiveInt("RABALUX_MIN_STOCK_ROWS", 2_000),
  );
  return items;
}

export async function fetchRabaluxSerbiaCatalog(supplier: Supplier) {
  const [catalog, current, weeklySnapshotCandidates] = await Promise.all([
    fetchRabaluxCatalog(supplier),
    db.product.findMany({
      where: { supplierId: supplier.id, supplierExternalId: { not: null } },
      select: {
        supplierExternalId: true,
        supplierStock: true,
        dcAvailableQty: true,
      },
    }),
    db.importRun.findMany({
      where: {
        supplierId: supplier.id,
        kind: "STOCK",
        dryRun: false,
        status: { in: ["SUCCESS", "PARTIAL"] },
        metadata: {
          path: ["sourceType"],
          equals: RABALUX_WEEKLY_STOCK_SOURCE_TYPE,
        },
      },
      orderBy: { finishedAt: "desc" },
      select: { id: true, metadata: true },
    }),
  ]);
  // PostgreSQL JSON comparisons return UNKNOWN for a missing key, so Prisma's
  // `NOT path = true` also rejects normal successful runs that omit the flag.
  const weeklySnapshot = weeklySnapshotCandidates.find((run) =>
    isCommittedRabaluxWeeklyStockMetadata(run.metadata),
  );
  if (!weeklySnapshot && process.env.NODE_ENV === "test") {
    const stock = await fetchRabaluxStock(supplier);
    const selection = selectRabaluxSerbiaStockCatalog(catalog.items, stock);
    return {
      source: catalog.source,
      weeklySnapshotActive: false,
      fallbackReason: catalog.fallbackReason,
      rawItems: catalog.items,
      stock,
      ...selection,
    };
  }
  if (!weeklySnapshot) {
    throw new Error(
      "Rabalux katalog čeka prvi potvrđeni nedeljni XLSX za Srbiju; zajednički stock feed nije dozvoljen.",
    );
  }
  const stock: RabaluxStockItem[] = current.map((product) => ({
    sourceSku: product.supplierExternalId!,
    stock: product.supplierStock ?? 0,
    status: "weekly-xlsx",
    outgoing: false,
    restricted: false,
    nextArrivalAt: null,
  }));
  const stockBySku = new Map(stock.map((item) => [item.sourceSku, item]));
  const currentBySku = new Map(
    current.map((product) => [product.supplierExternalId!, product]),
  );
  const eligibleStockSkus = new Set(
    current.map((product) => product.supplierExternalId!),
  );
  const items = catalog.items.filter((item) => eligibleStockSkus.has(item.sourceSku));
  const excludedMissingStock = catalog.items.filter(
    (item) => !currentBySku.has(item.sourceSku),
  ).length;
  const excludedWithoutStock = 0;
  return {
    source: catalog.source,
    weeklySnapshotActive: true,
    fallbackReason: catalog.fallbackReason,
    rawItems: catalog.items,
    stock,
    items,
    stockBySku,
    eligibleStockSkus: [...eligibleStockSkus].sort(),
    rawCatalogRows: catalog.items.length,
    stockRows: stock.length,
    excludedMissingStock,
    excludedWithoutStock,
    excludedRestricted: 0,
    excludedBySerbiaStockPolicy: excludedMissingStock + excludedWithoutStock,
  };
}

export function rabaluxSerbiaCatalogSourceHash(
  catalog: Awaited<ReturnType<typeof fetchRabaluxSerbiaCatalog>>,
) {
  return stableSourceHash({
    catalog: catalog.rawItems,
    eligibleStockSkus: catalog.eligibleStockSkus,
  });
}

export async function inspectRabaluxLiveFeeds() {
  const supplier = await getSupplier();
  const catalog = await fetchRabaluxSerbiaCatalog(supplier);
  return {
    source: catalog.source,
    ...summarizeRabaluxDryRun(catalog.rawItems, catalog.stock),
    serbiaStockEligibleRows: catalog.items.length,
    excludedBySerbiaStockPolicy: catalog.excludedBySerbiaStockPolicy,
  };
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
    const catalog = await fetchRabaluxSerbiaCatalog(supplier);
    summary.read = catalog.rawCatalogRows;
    const sourceHash = rabaluxSerbiaCatalogSourceHash(catalog);
    summary.metadata.sourceHash = sourceHash;
    if (options.expectedSourceHash && options.expectedSourceHash !== sourceHash) {
      throw new Error(
        "Rabalux catalog changed after preview. Create a new preview before execution.",
      );
    }
    summary.metadata.source = catalog.source;
    summary.metadata.rawCatalogRows = catalog.rawCatalogRows;
    summary.metadata.serbiaStockRows = catalog.stockRows;
    summary.metadata.serbiaStockEligibleRows = catalog.items.length;
    summary.metadata.excludedMissingSerbiaStock = catalog.excludedMissingStock;
    summary.metadata.excludedWithoutSerbiaStock = catalog.excludedWithoutStock;
    summary.metadata.excludedRestrictedSerbiaStock = catalog.excludedRestricted;
    summary.metadata.excludedBySerbiaStockPolicy =
      catalog.excludedBySerbiaStockPolicy;
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
        dcAvailableQty: true,
      },
    });
    assertFeedBaseline({
      kind: "catalog",
      actual: catalog.rawCatalogRows,
      absoluteMinimum: configuredPositiveInt("RABALUX_MIN_CATALOG_ROWS", 2_000),
      previousSuccessfulRows: await previousSuccessfulRowCount(
        supplier.id,
        "CATALOG",
        run.id,
      ),
    });
    const rawSeen = new Set(catalog.rawItems.map((item) => item.sourceSku));
    const eligibleSeen = new Set(catalog.items.map((item) => item.sourceSku));
    const catalogMissingCandidates = existingProducts.filter(
      (product) =>
        product.supplierExternalId && !rawSeen.has(product.supplierExternalId),
    );
    const missing = shouldReconcileMissingCatalogProducts(
      catalog.weeklySnapshotActive,
    )
      ? catalogMissingCandidates
      : [];
    summary.metadata.preservedByWeeklyStockAllowList =
      catalogMissingCandidates.length - missing.length;
    const outsideSerbiaStock = existingProducts.filter(
      (product) =>
        product.supplierExternalId &&
        rawSeen.has(product.supplierExternalId) &&
        !eligibleSeen.has(product.supplierExternalId),
    );
    assertSafeMissingShare({
      kind: "catalog",
      existing: existingProducts.length,
      missing: missing.length,
      allowLargeRemoval: options.allowLargeRemoval,
    });
    const policyRemovals = outsideSerbiaStock.filter(
      (product) => product.dcAvailableQty <= 0,
    );
    assertSafeMissingShare({
      kind: "catalog Serbia-stock policy",
      existing: existingProducts.filter((product) => product.dcAvailableQty <= 0)
        .length,
      missing: policyRemovals.length,
      allowLargeRemoval: options.allowLargeRemoval,
    });
    const pictogramIdsByCode = await ensureRabaluxPictogramDefinitions();
    const pictogramSync = await syncExistingRabaluxPictogramAssignments(
      supplier.id,
      catalog.items,
      pictogramIdsByCode,
    );
    summary.metadata.pictogramProductsSynchronized = pictogramSync.products;
    summary.metadata.pictogramAssignmentsSynchronized = pictogramSync.assignments;
    await db.importRun.update({
      where: { id: run.id },
      data: { metadata: summary.metadata as Prisma.InputJsonValue },
    });

    for (let start = 0; start < catalog.items.length; start += ITEM_CONCURRENCY) {
      const batch = catalog.items.slice(start, start + ITEM_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((item) =>
          upsertCatalogItem(
            supplier,
            item,
            run.id,
            sourceHash,
            options,
            pictogramIdsByCode,
            catalog.stockBySku.get(item.sourceSku)?.stock ?? 0,
          ),
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
    const stockPolicy = await deactivateOutsideSerbiaStockProducts({
      supplierId: supplier.id,
      runId: run.id,
      products: outsideSerbiaStock,
      reason: options.reason,
      reviewedById: options.requestedById,
    });
    summary.metadata.missingPending = disappearance.pending;
    summary.metadata.deactivatedAfterGrace = disappearance.deactivated;
    summary.metadata.removedOutsideSerbiaStock = stockPolicy.removed;
    summary.metadata.retainedOutsideSupplierStockDueToDc = stockPolicy.retainedDueToDc;
    summary.metadata.invalid = catalog.items.filter((item) => !item.valid).length;
    Object.assign(
      summary.metadata,
      await rabaluxVisibilityCounters(supplier.id),
      {
        pictogramAssignments: await db.productPictogram.count({
          where: { product: { supplierId: supplier.id, deletedAt: null } },
        }),
      },
    );
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
    const catalog = await fetchRabaluxSerbiaCatalog(supplier);
    assertFeedBaseline({
      kind: "catalog",
      actual: catalog.rawCatalogRows,
      absoluteMinimum: configuredPositiveInt("RABALUX_MIN_CATALOG_ROWS", 2_000),
      previousSuccessfulRows: await previousSuccessfulRowCount(
        supplier.id,
        "CATALOG",
        run.id,
      ),
    });
    const sourceHash = rabaluxSerbiaCatalogSourceHash(catalog);
    summary.metadata.sourceHash = sourceHash;
    summary.metadata.feedRows = catalog.rawCatalogRows;
    summary.metadata.serbiaStockRows = catalog.stockRows;
    summary.metadata.serbiaStockEligibleRows = catalog.items.length;
    summary.metadata.source = catalog.source;
    const item = catalog.items.find((candidate) => candidate.sourceSku === normalizedSku);
    if (!item) {
      const existsInCatalog = catalog.rawItems.some(
        (candidate) => candidate.sourceSku === normalizedSku,
      );
      throw new Error(
        existsInCatalog
          ? `Rabalux product ${normalizedSku} is not available in Serbia stock (requires a positive unrestricted quantity).`
          : `Rabalux product ${normalizedSku} is not in the complete Serbia catalog feed.`,
      );
    }
    summary.read = 1;
    const pictogramIdsByCode = await ensureRabaluxPictogramDefinitions();
    const result = await upsertCatalogItem(
      supplier,
      item,
      run.id,
      sourceHash,
      options,
      pictogramIdsByCode,
      catalog.stockBySku.get(item.sourceSku)?.stock ?? 0,
    );
    if (result.conflict) throw new Error(result.conflict);
    summary.ok = 1;
    summary[result.created ? "created" : "updated"] = 1;
    summary.mediaQueued = result.mediaQueued ? 1 : 0;
    summary.metadata.pictogramAssignments = result.pictogramsAssigned;
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

export async function syncRabaluxCatalogItemsForWeeklyStock(args: {
  supplier: Supplier;
  items: RabaluxCatalogItem[];
  stockBySourceSku: ReadonlyMap<string, number>;
  runId: string;
  requestedById: string;
  reason: string;
}) {
  if (!args.items.length) {
    return { created: 0, updated: 0, failed: 0, mediaQueued: 0, errors: [] };
  }
  const pictogramIdsByCode = await ensureRabaluxPictogramDefinitions();
  const sourceHash = stableSourceHash(args.items);
  const result = {
    created: 0,
    updated: 0,
    failed: 0,
    mediaQueued: 0,
    errors: [] as Array<{ sourceSku: string; message: string }>,
  };

  for (let start = 0; start < args.items.length; start += ITEM_CONCURRENCY) {
    const batch = args.items.slice(start, start + ITEM_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((item) =>
        upsertCatalogItem(
          args.supplier,
          item,
          args.runId,
          sourceHash,
          {
            requestedById: args.requestedById,
            reason: args.reason,
            allowRiskyPrices: false,
          },
          pictogramIdsByCode,
          args.stockBySourceSku.get(item.sourceSku) ?? 0,
        ),
      ),
    );
    settled.forEach((entry, index) => {
      if (entry.status === "rejected") {
        result.failed++;
        if (result.errors.length < MAX_RECORDED_ERRORS) {
          result.errors.push({
            sourceSku: batch[index].sourceSku,
            message: safeMessage(entry.reason),
          });
        }
        return;
      }
      if (entry.value.conflict) {
        result.failed++;
        if (result.errors.length < MAX_RECORDED_ERRORS) {
          result.errors.push({
            sourceSku: batch[index].sourceSku,
            message: entry.value.conflict,
          });
        }
        return;
      }
      result[entry.value.created ? "created" : "updated"]++;
      if (entry.value.mediaQueued) result.mediaQueued++;
    });
  }
  return result;
}

async function upsertCatalogItem(
  supplier: Supplier,
  item: RabaluxCatalogItem,
  runId: string,
  sourceHash: string,
  options: RabaluxSyncOptions,
  pictogramIdsByCode: RabaluxPictogramIdMap,
  serbiaStock: number,
) {
  const isPresentInSerbiaStock = serbiaStock > 0;
  const canPurchaseFromSerbiaStock =
    serbiaStock >= RABALUX_PUBLIC_STOCK_THRESHOLD;
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
        unitPackWidthCm: true,
        unitPackDepthCm: true,
        unitPackHeightCm: true,
        fullPrice: true,
        salePrice: true,
        discountPct: true,
        technicalSpecs: true,
        warrantyYears: true,
        countryOfOrigin: true,
        hsCode: true,
        isNew: true,
        newUntil: true,
        newUntilAutomatic: true,
        isActive: true,
        deletedAt: true,
        supplierApprovalStatus: true,
        categories: { select: { categoryId: true } },
        supplierCatalogMissingCount: true,
        lastSupplierSourceHash: true,
        media: {
          orderBy: { order: "asc" },
          select: { sourceUrl: true, kind: true, order: true, syncStatus: true },
        },
        attachments: {
          where: { origin: "SUPPLIER" },
          orderBy: { order: "asc" },
          select: {
            sourceUrl: true,
            kind: true,
            section: true,
            order: true,
            syncStatus: true,
          },
        },
        pictograms: {
          orderBy: { pictogram: { code: "asc" } },
          select: { pictogram: { select: { code: true } } },
        },
        familyMembership: {
          select: { family: { select: { primaryProductId: true } } },
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
          pictogramsAssigned: 0,
          conflict: message,
        };
      }
    }
    const overrideFields = parseOverrideFields(existing?.syncOverrides);
    const isSecondaryFamilyMember = Boolean(
      existing?.familyMembership &&
        existing.familyMembership.family.primaryProductId !== existing.id,
    );
    const incomingPictograms = [...item.pictogramCodes].sort();
    const existingRabaluxPictograms =
      existing?.pictograms
        .map((entry) => entry.pictogram.code)
        .filter((code) => RABALUX_PICTOGRAM_CODES.has(code))
        .sort() ?? [];
    const managedPictogramsMatch =
      isSecondaryFamilyMember ||
      overrideFields.has("pictograms") ||
      signature(existingRabaluxPictograms) === signature(incomingPictograms);
    const itemSourceHash = stableSourceHash({
      modelVersion: RABALUX_CATALOG_MODEL_VERSION,
      item,
    });
    if (
      existing &&
      existing.deletedAt === null &&
      existing.lastSupplierSourceHash === itemSourceHash &&
      existing.supplierCatalogMissingCount === 0 &&
      (isPresentInSerbiaStock || !existing.isActive) &&
      managedPictogramsMatch &&
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
        pictogramsAssigned: existing.pictograms.length,
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
      section: asset.section,
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
    const pictogramsChanged =
      !existing ||
      (!overrideFields.has("pictograms") &&
        signature(existingRabaluxPictograms) !== signature(incomingPictograms));
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
      isPresentInSerbiaStock &&
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
      unitPackWidthCm: decimal(item.unitPackWidthCm),
      unitPackDepthCm: decimal(item.unitPackDepthCm),
      unitPackHeightCm: decimal(item.unitPackHeightCm),
      fullPrice: new Prisma.Decimal(item.fullPrice),
      salePrice: null,
      discountPct: null,
      technicalSpecs: item.technicalSpecs as Prisma.InputJsonValue,
      warrantyYears: item.warrantyYears,
      countryOfOrigin: item.countryOfOrigin,
      hsCode: item.hsCode,
      isNew: false,
      newUntil: null,
      newUntilAutomatic: false,
      isDtz: false,
      stock: 0,
      incomingStock: 0,
      supplierStock: 0,
      allowsAssembly: false,
      supplierId: supplier.id,
      supplierExternalId: item.sourceSku,
      isActive: activeCandidate,
      availableWebAuto: activeCandidate && canPurchaseFromSerbiaStock,
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
        !isSecondaryFamilyMember &&
        !isRabaluxFieldLocked(overrideFields, "pricing") &&
        Number(existing.fullPrice) !== item.fullPrice &&
        isRiskyPriceChange(Number(existing.fullPrice), item.fullPrice),
    );
    let familyConflictMessage: string | null = null;
    if (existing) {
      const updateData = omitSupplierProductNewnessUpdates(
        preserveExistingProductDescriptions(
          applyRabaluxOverrides(
            data as unknown as Record<string, unknown>,
            overrideFields,
          ),
          existing,
        ),
      ) as Prisma.ProductUncheckedUpdateInput;
      // Rabalux is never eligible for the automatic "Novo" or DTZ systems.
      updateData.isNew = false;
      updateData.newUntil = null;
      updateData.newUntilAutomatic = false;
      updateData.isDtz = false;
      if (!canPurchaseFromSerbiaStock) {
        updateData.availableWebAuto = false;
      }
      // A positive Serbia-stock item may return after a prior soft removal.
      // A zero-stock catalog refresh must not revive a removed product.
      if (isPresentInSerbiaStock) updateData.deletedAt = null;
      else delete (updateData as Record<string, unknown>).deletedAt;
      delete (updateData as Record<string, unknown>).stock;
      delete (updateData as Record<string, unknown>).supplierStock;
      delete (updateData as Record<string, unknown>).incomingStock;
      // Existing legacy sale values are preserved as a read-only fallback, but
      // supplier sync may no longer create or overwrite legacy sale fields.
      delete (updateData as Record<string, unknown>).salePrice;
      delete (updateData as Record<string, unknown>).discountPct;
      if (!categoryId) delete (updateData as Record<string, unknown>).groupId;
      if (!item.valid || (riskyPrice && !options.allowRiskyPrices)) {
        delete (updateData as Record<string, unknown>).fullPrice;
        delete (updateData as Record<string, unknown>).salePrice;
        delete (updateData as Record<string, unknown>).discountPct;
      }
      if (item.valid && !mediaChanged && isPresentInSerbiaStock) {
        delete (updateData as Record<string, unknown>).isActive;
      }
      if (overrideFields.has("media") && isPresentInSerbiaStock) {
        delete (updateData as Record<string, unknown>).isActive;
      }
      if (isSecondaryFamilyMember) {
        const sharedSupplierFields = [
          "name", "description", "shortDescription", "groupId", "widthCm",
          "depthCm", "heightCm", "weightKg", "grossWeightKg",
          "unitPackWidthCm", "unitPackDepthCm", "unitPackHeightCm",
          "fullPrice", "technicalSpecs", "warrantyYears", "countryOfOrigin",
          "hsCode",
        ];
        const blockedFields = sharedSupplierFields.filter((field) => {
          const incoming = (updateData as Record<string, unknown>)[field];
          const current = (existing as unknown as Record<string, unknown>)[field];
          return field in updateData && JSON.stringify(incoming ?? null) !== JSON.stringify(current ?? null);
        });
        for (const field of sharedSupplierFields) {
          delete (updateData as Record<string, unknown>)[field];
        }
        if (blockedFields.length) {
          familyConflictMessage = `Sporedna boja ${existing.sku} ima konflikt zajedničkih supplier polja; autoritet je glavna boja porodice.`;
          await tx.supplierSyncChange.create({
            data: {
              supplierId: supplier.id,
              importRunId: runId,
              productId: existing.id,
              externalSku: item.sourceSku,
              changeType: "FAMILY_SHARED_CONFLICT",
              status: "CONFLICT",
              fieldNames: blockedFields,
              before: jsonSnapshot(existing),
              after: jsonSnapshot(item),
              reversible: false,
              reason: familyConflictMessage,
            },
          });
        }
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
            fieldNames: ["fullPrice"],
            before: jsonSnapshot({
              fullPrice: existing.fullPrice,
            }),
            after: jsonSnapshot({
              fullPrice: item.fullPrice,
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
      item.valid &&
      !isSecondaryFamilyMember &&
      !isRabaluxFieldLocked(overrideFields, "pricing") &&
      (!riskyPrice || options.allowRiskyPrices)
    ) {
      await upsertActiveRetailPrice(tx, {
        productId,
        price: item.fullPrice,
      });
    }

    if (
      !isSecondaryFamilyMember &&
      categoryId &&
      !overrideFields.has("categories") &&
      !overrideFields.has("category")
    ) {
      await tx.productCategory.deleteMany({ where: { productId } });
      await tx.productCategory.create({ data: { productId, categoryId } });
    }

    if (!isSecondaryFamilyMember && !overrideFields.has("materials")) {
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

    if (
      !isSecondaryFamilyMember &&
      pictogramsChanged &&
      !overrideFields.has("pictograms")
    ) {
      const pictogramIds = incomingPictograms
        .map((code) => pictogramIdsByCode.get(code))
        .filter((id): id is string => Boolean(id));
      await tx.productPictogram.deleteMany({
        where: {
          productId,
          pictogramId: { in: [...pictogramIdsByCode.values()] },
        },
      });
      if (pictogramIds.length) {
        await tx.productPictogram.createMany({
          data: pictogramIds.map((pictogramId) => ({ productId, pictogramId })),
          skipDuplicates: true,
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

    if (!isSecondaryFamilyMember && attachmentsChanged && !overrideFields.has("attachments")) {
      await tx.productAttachment.deleteMany({
        where: { productId, origin: "SUPPLIER" },
      });
      if (item.attachments.length) {
        await tx.productAttachment.createMany({
          data: item.attachments.map((asset) => ({
            productId,
            section: asset.section,
            origin: "SUPPLIER",
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

    if (
      existing?.familyMembership?.family.primaryProductId === productId
    ) {
      await propagateProductFamilySharedData(tx, productId);
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
        unitPackWidthCm: true,
        unitPackDepthCm: true,
        unitPackHeightCm: true,
        fullPrice: true,
        salePrice: true,
        discountPct: true,
        technicalSpecs: true,
        warrantyYears: true,
        countryOfOrigin: true,
        hsCode: true,
        isNew: true,
        newUntil: true,
        newUntilAutomatic: true,
        isActive: true,
        articleStatus: true,
        supplierApprovalStatus: true,
        categories: { select: { categoryId: true } },
        media: {
          orderBy: { order: "asc" },
          select: { sourceUrl: true, kind: true, order: true, syncStatus: true },
        },
        attachments: {
          where: { origin: "SUPPLIER" },
          orderBy: { order: "asc" },
          select: {
            sourceUrl: true,
            kind: true,
            section: true,
            order: true,
            syncStatus: true,
          },
        },
        pictograms: {
          orderBy: { pictogram: { code: "asc" } },
          select: { pictogram: { select: { code: true } } },
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
      pictogramsAssigned: after.pictograms.length,
      mediaTarget: nextMedia
        ? { assetId: nextMedia.id, assetType: "MEDIA" as const }
        : nextAttachment
          ? {
              assetId: nextAttachment.id,
              assetType: "ATTACHMENT" as const,
            }
          : null,
      conflict: familyConflictMessage,
    };
  });

  if (result.mediaQueued && result.mediaTarget) {
    await enqueueBackgroundJob({
      kind: "RABALUX_MEDIA_PRODUCT",
      payload: { productId: result.productId, ...result.mediaTarget },
      idempotencyKey: rabaluxMediaJobIdempotencyKey(
        result.mediaTarget.assetId,
        result.mediaTarget.assetType,
      ),
      maxAttempts: 12,
    });
  }
  return result;
}

export async function syncRabaluxStock(options: RabaluxSyncOptions = {}) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "Rabalux lager se više ne sinhronizuje iz zajedničkog feeda. Koristite potvrđeni nedeljni XLSX za Srbiju.",
    );
  }
  /* c8 ignore start -- retained temporarily for rollback compatibility */
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
      where: { supplierId: supplier.id },
      select: {
        id: true,
        supplierExternalId: true,
        supplierStock: true,
        supplierReservedStock: true,
        supplierNextArrivalAt: true,
        lastSupplierStockSyncAt: true,
        dcAvailableQty: true,
        supplierStockMissingCount: true,
        supplierStockMissingSince: true,
        syncOverrides: true,
        articleStatus: true,
        isDtz: true,
        isActive: true,
        deletedAt: true,
        supplierApprovalStatus: true,
      },
    });
    const currentProducts = products.filter((product) => product.deletedAt === null);
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
    const catalogOnly = currentProducts.filter(
      (product) =>
        product.supplierExternalId && !seen.has(product.supplierExternalId),
    );
    assertSafeMissingShare({
      kind: "stock",
      existing: currentProducts.length,
      missing: catalogOnly.length,
      allowLargeRemoval: options.allowLargeRemoval,
    });
    const stockBySourceSku = new Map(stock.map((item) => [item.sourceSku, item]));
    const supplierOnlyProducts = currentProducts.filter(
      (product) => product.dcAvailableQty <= 0,
    );
    const policyRemovals = supplierOnlyProducts.filter((product) => {
      const item = product.supplierExternalId
        ? stockBySourceSku.get(product.supplierExternalId)
        : undefined;
      return Boolean(item && !isRabaluxSerbiaStockPresent(item));
    });
    assertSafeMissingShare({
      kind: "stock Serbia removal policy",
      existing: supplierOnlyProducts.length,
      missing: policyRemovals.length,
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
    Object.assign(
      summary.metadata,
      await rabaluxVisibilityCounters(supplier.id),
      {
        pictogramAssignments: await db.productPictogram.count({
          where: { product: { supplierId: supplier.id, deletedAt: null } },
        }),
      },
    );
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
  /* c8 ignore stop */
}

async function updateStockItem(
  supplierId: string,
  runId: string,
  product: {
    id: string;
    supplierExternalId: string | null;
    supplierStock: number | null;
    supplierReservedStock: number;
    supplierNextArrivalAt: Date | null;
    lastSupplierStockSyncAt: Date | null;
    dcAvailableQty: number;
    supplierStockMissingCount: number;
    supplierStockMissingSince: Date | null;
    syncOverrides: Prisma.JsonValue | null;
    articleStatus: "SP" | "IT" | "DTZ" | "DOB" | "ARH" | "UZ";
    isDtz: boolean;
    isActive: boolean;
    deletedAt: Date | null;
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
  const now = new Date();
  const serbiaStockPresent = isRabaluxSerbiaStockPresent(item);
  const serbiaWebStockAvailable = isRabaluxSerbiaWebStockAvailable(item);
  const stockPolicyAllowsPublication =
    product.dcAvailableQty > 0 || serbiaWebStockAvailable;
  const keepOnSite = product.dcAvailableQty > 0 || serbiaStockPresent;
  const nextStatus = item.restricted
    ? "ARH"
    : !isRabaluxFieldLocked(parseOverrideFields(product.syncOverrides), "flags") ||
        product.articleStatus === "DTZ"
      ? "SP"
      : product.articleStatus;
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
      deletedAt: product.deletedAt,
    });
    await tx.product.update({
      where: { id: product.id },
      data: {
        ...(!stockLocked
          ? {
              supplierStock: item.stock,
              supplierNextArrivalAt: item.nextArrivalAt,
              lastSupplierStockSyncAt: now,
              availableWebAuto:
                !item.restricted &&
                (product.dcAvailableQty > 0 ||
                  (product.supplierApprovalStatus === "APPROVED" &&
                    item.stock >= RABALUX_PUBLIC_STOCK_THRESHOLD)),
            }
          : {}),
        // Supplier status can never turn Rabalux into a DTZ product. The Serbia
        // stock publication rule is hard policy and overrides manual flags.
        isDtz: false,
        articleStatus: nextStatus,
        deletedAt: keepOnSite ? null : (product.deletedAt ?? now),
        ...(!stockPolicyAllowsPublication
          ? {
              isActive: false,
              availableWebAuto: false,
            }
          : {}),
        supplierStockMissingCount: 0,
        supplierStockMissingSince: null,
        lastSupplierSyncAt: now,
      },
    });
    if (!item.restricted && !flagsLocked) {
      const readiness = await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        select: {
          fullPrice: true,
          priceListEntries: {
            where: activeRetailPriceEntryWhere(),
            take: 1,
            select: { price: true },
          },
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
            stockPolicyAllowsPublication &&
            readiness.supplierApprovalStatus === "APPROVED" &&
            readiness.priceListEntries.length > 0 &&
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
        deletedAt: true,
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

async function deactivateOutsideSerbiaStockProducts(args: {
  supplierId: string;
  runId: string;
  products: Array<{
    id: string;
    supplierExternalId: string | null;
    supplierCatalogMissingCount: number;
    supplierCatalogMissingSince: Date | null;
    isActive: boolean;
    dcAvailableQty: number;
  }>;
  reason?: string;
  reviewedById?: string;
}) {
  const now = new Date();
  let removed = 0;
  let retainedDueToDc = 0;

  for (let start = 0; start < args.products.length; start += ITEM_CONCURRENCY) {
    const results = await Promise.all(
      args.products.slice(start, start + ITEM_CONCURRENCY).map(async (product) => {
        if (product.dcAvailableQty > 0) {
          await db.product.update({
            where: { id: product.id },
            data: {
              supplierCatalogMissingCount: 0,
              supplierCatalogMissingSince: null,
              lastSupplierSyncAt: now,
            },
          });
          return "retained" as const;
        }

        await db.$transaction(async (tx) => {
          await tx.product.update({
            where: { id: product.id },
            data: {
              isActive: false,
              availableWebAuto: false,
              deletedAt: now,
              supplierCatalogMissingCount: 0,
              supplierCatalogMissingSince: null,
              lastSupplierSyncAt: now,
            },
          });
          await tx.supplierSyncChange.create({
            data: {
              supplierId: args.supplierId,
              importRunId: args.runId,
              productId: product.id,
              externalSku: product.supplierExternalId!,
              changeType: "REMOVE_OUTSIDE_RS_STOCK",
              status: "APPLIED",
              fieldNames: ["isActive", "availableWebAuto", "deletedAt"],
              before: jsonSnapshot({
                isActive: product.isActive,
                deletedAt: null,
              }),
              after: jsonSnapshot({
                isActive: false,
                availableWebAuto: false,
                deletedAt: now,
              }),
              appliedAt: now,
              reason:
                args.reason ??
                "Not present with a positive unrestricted quantity in the Rabalux Serbia stock feed.",
              reviewedById: args.reviewedById,
            },
          });
        });
        return "removed" as const;
      }),
    );
    for (const result of results) {
      if (result === "removed") removed++;
      else retainedDueToDc++;
    }
  }

  return { removed, retainedDueToDc };
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
    supplierReservedStock: number;
    lastSupplierStockSyncAt: Date | null;
    dcAvailableQty: number;
    isActive: boolean;
    supplierApprovalStatus:
      | "PENDING_MAPPING"
      | "PENDING_APPROVAL"
      | "APPROVED"
      | "REJECTED"
      | null;
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
        const missingConfirmed = missingGraceSatisfied({
          nextCount,
          firstMissingAt,
          now,
          confirmations,
          graceMs: graceMinutes * 60 * 1_000,
        });
        const shouldZero = !stockLocked && missingConfirmed;
        const shouldRemove = missingConfirmed && product.dcAvailableQty <= 0;
        const availability = resolveRabaluxAvailability({
          warehouseStock: product.dcAvailableQty,
          supplierStock: shouldZero ? 0 : product.supplierStock,
          supplierReservedStock: product.supplierReservedStock,
          lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
          supplierOperational: true,
          supplierApproved: product.supplierApprovalStatus === "APPROVED",
          now,
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
              availableWebAuto: shouldRemove
                ? false
                : availability.sellableStock > 0,
              ...(shouldZero
                ? { supplierStock: 0, supplierNextArrivalAt: null }
                : {}),
              ...(shouldRemove
                ? { isActive: false, availableWebAuto: false, deletedAt: now }
                : {}),
            },
          });
          if (
            (shouldZero && (product.supplierStock ?? 0) !== 0) ||
            shouldRemove
          ) {
            const fieldNames = shouldZero
              ? ["supplierStock", "supplierNextArrivalAt"]
              : [];
            if (shouldRemove) fieldNames.push("isActive", "deletedAt");
            await tx.supplierSyncChange.create({
              data: {
                supplierId: args.supplierId,
                importRunId: args.runId,
                productId: product.id,
                externalSku: product.supplierExternalId!,
                changeType: shouldRemove
                  ? "REMOVE_MISSING_RS_STOCK"
                  : "ZERO_MISSING_STOCK",
                status: "APPLIED",
                fieldNames,
                before: jsonSnapshot({
                  supplierStock: product.supplierStock,
                  supplierNextArrivalAt: product.supplierNextArrivalAt,
                  isActive: product.isActive,
                  deletedAt: null,
                }),
                after: jsonSnapshot({
                  supplierStock: shouldZero ? 0 : product.supplierStock,
                  supplierNextArrivalAt: shouldZero
                    ? null
                    : product.supplierNextArrivalAt,
                  isActive: shouldRemove ? false : product.isActive,
                  deletedAt: shouldRemove ? now : null,
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
        if (missingConfirmed) zeroed++;
        else pending++;
      }),
    );
  }
  return { pending, zeroed };
}

function jsonSnapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function rabaluxVisibilityCounters(supplierId: string) {
  const products = await db.product.findMany({
    where: { supplierId, deletedAt: null },
    select: {
      articleStatus: true,
      dcAvailableQty: true,
      supplierStock: true,
      supplierApprovalStatus: true,
      lastSupplierStockSyncAt: true,
    },
  });
  return products.reduce(
    (counts, product) => {
      if (product.articleStatus === "ARH") counts.hiddenByPolicy++;
      else if (product.dcAvailableQty > 0) counts.visibleDueToDc++;
      else if (
        product.supplierApprovalStatus === "APPROVED" &&
        (product.supplierStock ?? 0) >= RABALUX_PUBLIC_STOCK_THRESHOLD &&
        isRabaluxStockFresh(product.lastSupplierStockSyncAt)
      ) {
        counts.visibleDueToSupplier++;
      } else counts.hiddenByPolicy++;
      return counts;
    },
    { visibleDueToSupplier: 0, visibleDueToDc: 0, hiddenByPolicy: 0 },
  );
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

function signature(values: readonly unknown[]) {
  return stableSourceHash(
    values.map((value) => {
      if (!value || typeof value !== "object") return value;
      const asset = value as Record<string, unknown>;
      if (!("sourceUrl" in asset)) return value;
      return {
        sourceUrl: asset.sourceUrl ?? null,
        kind: asset.kind,
        ...(asset.section ? { section: asset.section } : {}),
        order: asset.order,
      };
    }),
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
