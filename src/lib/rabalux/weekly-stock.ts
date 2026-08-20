import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type Supplier } from "@prisma/client";
import { db } from "@/lib/db";
import { activeRetailPriceEntryWhere } from "@/lib/pricing/retail-price-write.server";
import { getManagedProductMediaStorageKeys } from "@/lib/supabase/storage";
import { RABALUX_PUBLIC_STOCK_THRESHOLD } from "./availability";
import { isRabaluxSupplierOperational, RABALUX_INTEGRATION_KEY } from "./config";
import {
  acquireSyncLease,
  configuredPositiveInt,
  configuredRatio,
  releaseSyncLease,
  stableSourceHash,
} from "./safety";
import { fetchRabaluxCatalog, syncRabaluxCatalogItemsForWeeklyStock } from "./sync";
import { rabaluxSku, slugifyRabalux } from "./parser";
import {
  parseRabaluxStockReportDate,
  parseRabaluxWeeklyStockXlsx,
  type RabaluxWeeklyStockParseResult,
  type RabaluxWeeklyStockRow,
} from "./weekly-stock-file";
import {
  isCommittedRabaluxWeeklyStockMetadata,
  RABALUX_WEEKLY_STOCK_SOURCE_TYPE,
  resolveRabaluxWeeklyStockPolicy,
} from "./weekly-stock-policy";

const SOURCE_TYPE = RABALUX_WEEKLY_STOCK_SOURCE_TYPE;
const CONFIRMATION_PHRASE = "RABALUX STANJE";
const PREVIEW_TTL_MS = 10 * 60_000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

type WeeklyProduct = Awaited<ReturnType<typeof loadWeeklyProducts>>[number];

export type RabaluxWeeklyStockPreviewSummary = {
  fileName: string;
  sheetName: string;
  reportDate: string;
  title: string;
  validRows: number;
  uniqueSkus: number;
  duplicateRows: number;
  ignoredRows: number;
  totalUnits: number;
  positiveSkus: number;
  lowStockSkus: number;
  activeThresholdSkus: number;
  zeroStockSkus: number;
  matchedSkus: number;
  fileOnlySkus: number;
  fileOnlyPositiveSkus: number;
  fileOnlyActiveThresholdSkus: number;
  siteOnlyProducts: number;
  stockChanges: number;
  increases: number;
  decreases: number;
  activations: number;
  deactivations: number;
  deletions: number;
  storageFilesToDelete: number;
  restores: number;
  unchanged: number;
  samples: Array<{
    sourceSku: string;
    name: string;
    current: number;
    target: number;
    action: string;
  }>;
};

export type RabaluxWeeklyStockPreviewResult = {
  token: string;
  phrase: string;
  expiresAt: string;
  summary: RabaluxWeeklyStockPreviewSummary;
};

export type RabaluxWeeklyStockApplyResult = {
  runId: string;
  summary: RabaluxWeeklyStockPreviewSummary;
  catalogCreated: number;
  catalogUpdated: number;
  catalogFailed: number;
  catalogMissing: number;
  placeholderCreated: number;
  updatedProducts: number;
  deletedProducts: number;
  storageFilesQueuedForDeletion: number;
};

export async function createRabaluxWeeklyStockPreview(args: {
  actorId: string;
  fileName: string;
  bytes: Uint8Array;
  now?: Date;
}): Promise<RabaluxWeeklyStockPreviewResult> {
  const supplier = await getOperationalSupplier();
  const prepared = await prepareFile(args.fileName, args.bytes, args.now);
  await assertNotAlreadyApplied(supplier.id, prepared.fileHash);
  await assertReportDateNotOlder(supplier.id, prepared.parsed.reportDate!);
  await assertWeeklyBaseline(supplier.id, prepared.parsed.rows.length);

  const products = await loadWeeklyProducts(supplier.id);
  const stateHash = weeklyStateHash(products);
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  const token = `${id}.${secret}`;
  const expiresAt = new Date((args.now ?? new Date()).getTime() + PREVIEW_TTL_MS);

  await db.importRun.create({
    data: {
      id,
      supplierId: supplier.id,
      kind: "STOCK",
      dryRun: true,
      status: "RUNNING",
      requestedById: args.actorId,
      sourceHash: prepared.fileHash,
    },
  });

  try {
    const preview = buildPreview({
      supplierId: supplier.id,
      runId: id,
      fileName: args.fileName,
      parsed: prepared.parsed,
      products,
    });
    for (let start = 0; start < preview.changes.length; start += 500) {
      await db.supplierSyncChange.createMany({
        data: preview.changes.slice(start, start + 500),
      });
    }
    await db.importRun.update({
      where: { id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        recordsRead: prepared.parsed.rows.length,
        recordsOk: prepared.parsed.rows.length,
        metadata: {
          sourceType: SOURCE_TYPE,
          actorId: args.actorId,
          fileName: args.fileName,
          reportDate: prepared.parsed.reportDate,
          normalizedHash: prepared.normalizedHash,
          stateHash,
          tokenHash: hashToken(token),
          expiresAt: expiresAt.toISOString(),
          consumedAt: null,
          completeSnapshot: true,
          summary: preview.summary,
        } as Prisma.InputJsonValue,
      },
    });
    return {
      token,
      phrase: CONFIRMATION_PHRASE,
      expiresAt: expiresAt.toISOString(),
      summary: preview.summary,
    };
  } catch (error) {
    await failRun(id, error);
    throw error;
  }
}

export async function applyRabaluxWeeklyStock(args: {
  actorId: string;
  fileName: string;
  bytes: Uint8Array;
  token: string;
  phrase: string;
  reason: string;
  now?: Date;
}): Promise<RabaluxWeeklyStockApplyResult> {
  const now = args.now ?? new Date();
  const reason = args.reason.trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new Error("Razlog mora imati između 5 i 500 znakova.");
  }
  if (args.phrase.trim() !== CONFIRMATION_PHRASE) {
    throw new Error(`Unesite tačnu potvrdu: ${CONFIRMATION_PHRASE}`);
  }

  const supplier = await getOperationalSupplier();
  const prepared = await prepareFile(args.fileName, args.bytes, now);
  await assertNotAlreadyApplied(supplier.id, prepared.fileHash);
  await assertReportDateNotOlder(supplier.id, prepared.parsed.reportDate!);
  await assertWeeklyBaseline(supplier.id, prepared.parsed.rows.length);
  const observedAt = reportObservationTime(prepared.parsed.reportDate!);
  const productsAtConfirmation = await loadWeeklyProducts(supplier.id);
  const stateHash = weeklyStateHash(productsAtConfirmation);
  const confirmation = await consumePreview({
    actorId: args.actorId,
    supplierId: supplier.id,
    token: args.token,
    fileHash: prepared.fileHash,
    stateHash,
    reason,
  });

  const run = await db.importRun.create({
    data: {
      supplierId: supplier.id,
      kind: "STOCK",
      status: "RUNNING",
      previewRunId: confirmation.previewRunId,
      requestedById: args.actorId,
      sourceHash: prepared.fileHash,
      metadata: {
        sourceType: SOURCE_TYPE,
        fileName: args.fileName,
        reportDate: prepared.parsed.reportDate,
        normalizedHash: prepared.normalizedHash,
        completeSnapshot: true,
        reason,
      } as Prisma.InputJsonValue,
    },
  });

  let leaseAcquired = false;
  let catalogCreated = 0;
  let catalogUpdated = 0;
  let catalogFailed = 0;
  let catalogMissing = 0;
  let placeholderCreated = 0;
  let catalogErrors: Array<{ sourceSku: string; message: string }> = [];
  let stockCommitted = false;
  try {
    await acquireSyncLease({ supplierId: supplier.id, runId: run.id, scope: "STOCK" });
    leaseAcquired = true;

    const rowBySku = new Map(
      prepared.parsed.rows.map((row) => [row.sourceSku, row] as const),
    );
    const matchedBeforeCatalog = matchRowsToProducts(
      prepared.parsed.rows,
      productsAtConfirmation,
    );
    const fileOnlyRows = prepared.parsed.rows.filter(
      (row) => !matchedBeforeCatalog.matchedRowSkus.has(row.sourceSku),
    );

    if (fileOnlyRows.length) {
      const catalog = await fetchRabaluxCatalog(supplier);
      const needed = new Set(fileOnlyRows.map((row) => row.sourceSku));
      const catalogItems = catalog.items.filter((item) => needed.has(item.sourceSku));
      catalogMissing = needed.size - catalogItems.length;
      const catalogResult = await syncRabaluxCatalogItemsForWeeklyStock({
        supplier,
        items: catalogItems,
        stockBySourceSku: new Map(
          prepared.parsed.rows.map((row) => [row.sourceSku, row.closingStock]),
        ),
        runId: run.id,
        requestedById: args.actorId,
        reason,
      });
      catalogCreated = catalogResult.created;
      catalogUpdated = catalogResult.updated;
      catalogFailed = catalogResult.failed;
      catalogErrors = catalogResult.errors;
    }

    const productsAfterCatalog = await loadWeeklyProducts(supplier.id);
    const matchedAfterCatalog = matchRowsToProducts(
      prepared.parsed.rows,
      productsAfterCatalog,
    );
    const placeholderRows = fileOnlyRows.filter(
      (row) => !matchedAfterCatalog.matchedRowSkus.has(row.sourceSku),
    );
    if (placeholderRows.length) {
      placeholderCreated = await createWeeklyStockPlaceholders({
        supplierId: supplier.id,
        rows: placeholderRows,
        observedAt,
        now,
        runId: run.id,
        reason,
        actorId: args.actorId,
      });
    }

    const products = await loadWeeklyProducts(supplier.id);
    const matchedAfterPlaceholders = matchRowsToProducts(
      prepared.parsed.rows,
      products,
    );
    catalogMissing = fileOnlyRows.filter(
      (row) => !matchedAfterPlaceholders.matchedRowSkus.has(row.sourceSku),
    ).length;
    const preview = buildPreview({
      supplierId: supplier.id,
      runId: run.id,
      fileName: args.fileName,
      parsed: prepared.parsed,
      products,
    });
    const plans = products.flatMap((product) => {
      const matchedSku = productSourceSku(product, rowBySku);
      const row = matchedSku ? rowBySku.get(matchedSku) : undefined;
      return row ? [stockPlan(product, row, observedAt)] : [];
    });
    const productsToDelete = products.filter(
      (product) => !productSourceSku(product, rowBySku),
    );
    const storageKeysToDelete = managedStorageKeys(productsToDelete);
    const stockChanged = plans.filter(
      (plan) => (plan.product.supplierStock ?? 0) !== plan.stock,
    );
    const materialChanges = plans.filter((plan) => plan.fields.length > 0);

    await db.$transaction(
      async (tx) => {
        if (stockChanged.length) {
          await tx.supplierStockSnapshot.createMany({
            data: stockChanged.map((plan) => ({
              supplierId: supplier.id,
              productId: plan.product.id,
              externalSku:
                plan.matchedSku ?? plan.product.supplierExternalId ?? plan.product.sku,
              stock: plan.stock,
              incomingStock: 0,
              capturedAt: observedAt,
            })),
          });
        }
        if (materialChanges.length) {
          await tx.supplierSyncChange.createMany({
            data: materialChanges.map((plan) => ({
              supplierId: supplier.id,
              importRunId: run.id,
              productId: plan.product.id,
              externalSku:
                plan.matchedSku ?? plan.product.supplierExternalId ?? plan.product.sku,
              changeType: "WEEKLY_STOCK_UPDATE",
              status: "APPLIED" as const,
              fieldNames: plan.fields,
              before: json(plan.before),
              after: json(plan.after),
              reversible: true,
              reason,
              appliedAt: now,
              reviewedById: args.actorId,
            })),
          });
        }
        if (productsToDelete.length) {
          await tx.supplierSyncChange.createMany({
            data: productsToDelete.map((product) => ({
              supplierId: supplier.id,
              importRunId: run.id,
              productId: product.id,
              externalSku: product.supplierExternalId ?? product.sku,
              changeType: "WEEKLY_CATALOG_DELETE",
              status: "APPLIED" as const,
              fieldNames: ["product", "media", "attachments"],
              before: json(deletionSnapshot(product)),
              after: Prisma.JsonNull,
              reversible: false,
              reason,
              appliedAt: now,
              reviewedById: args.actorId,
            })),
          });
        }
        for (let start = 0; start < plans.length; start += 300) {
          const batch = plans.slice(start, start + 300);
          await tx.$executeRaw(Prisma.sql`
            UPDATE "Product" AS product
               SET "supplierStock" = incoming.stock,
                   "supplierNextArrivalAt" = NULL,
                   "lastSupplierStockSyncAt" = ${observedAt},
                   "supplierStockMissingCount" = incoming.missing_count,
                   "supplierStockMissingSince" = incoming.missing_since,
                   "isDtz" = FALSE,
                   "isActive" = incoming.is_active,
                   "availableWebAuto" = incoming.web_auto,
                   "deletedAt" = incoming.deleted_at,
                   "lastSupplierSyncAt" = ${now},
                   "updatedAt" = ${now}
              FROM (VALUES ${Prisma.join(
                batch.map((plan) => Prisma.sql`(
                  ${plan.product.id}::text,
                  ${plan.stock}::integer,
                  0::integer,
                  NULL::timestamptz,
                  ${plan.isActive}::boolean,
                  ${plan.availableWebAuto}::boolean,
                  ${plan.deletedAt}::timestamptz
                )`),
              )}) AS incoming(
                id, stock, missing_count, missing_since, is_active, web_auto, deleted_at
              )
             WHERE product.id = incoming.id
          `);
        }
        if (productsToDelete.length) {
          const productIds = productsToDelete.map((product) => product.id);
          // Historical rows keep their SKU/name snapshots but no longer point
          // at a catalog Product. Operational rows that require a Product are
          // removed together with it.
          await tx.supplierStockSnapshot.updateMany({
            where: { productId: { in: productIds } },
            data: { productId: null },
          });
          await tx.orderItem.updateMany({
            where: { productId: { in: productIds } },
            data: { productId: null },
          });
          await tx.reclamation.updateMany({
            where: { productId: { in: productIds } },
            data: { productId: null },
          });
          await tx.partnerReservation.deleteMany({
            where: { productId: { in: productIds } },
          });
          await tx.stockCountItem.deleteMany({
            where: { productId: { in: productIds } },
          });
          await tx.$executeRaw(Prisma.sql`
            DELETE FROM "BackgroundJob"
             WHERE "kind" = 'RABALUX_MEDIA_PRODUCT'
               AND "payload"->>'productId' IN (${Prisma.join(productIds)})
          `);
          const storageBatches = chunk(storageKeysToDelete, 100);
          if (storageBatches.length) {
            await tx.backgroundJob.createMany({
              data: storageBatches.map((keys, index) => ({
                kind: "RABALUX_MEDIA_DELETE",
                payload: { keys } as Prisma.InputJsonValue,
                idempotencyKey: `rabalux-media-delete:${run.id}:${index}`,
                maxAttempts: 12,
              })),
            });
          }
          await tx.product.deleteMany({ where: { id: { in: productIds } } });
        }
      },
      { timeout: 120_000 },
    );
    stockCommitted = true;

    const missingCatalogSkus = fileOnlyRows
      .filter((row) => !products.some((product) => productSourceSku(product, rowBySku) === row.sourceSku))
      .map((row) => row.sourceSku);
    const status = catalogFailed || catalogMissing ? "PARTIAL" : "SUCCESS";
    await db.importRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        recordsRead: prepared.parsed.rows.length,
        recordsOk: prepared.parsed.rows.length - catalogFailed - catalogMissing,
        recordsFail: catalogFailed + catalogMissing,
        errorMessage:
          catalogErrors[0]?.message ??
          (catalogMissing ? `${catalogMissing} šifara nije pronađeno u katalogu.` : null),
        errors: catalogErrors.length ? json(catalogErrors) : Prisma.JsonNull,
        metadata: {
          sourceType: SOURCE_TYPE,
          fileName: args.fileName,
          reportDate: prepared.parsed.reportDate,
          normalizedHash: prepared.normalizedHash,
          completeSnapshot: true,
          reason,
          summary: preview.summary,
          positiveRows: prepared.parsed.rows
            .filter((row) => row.closingStock > 0)
            .map((row) => ({ sourceSku: row.sourceSku, stock: row.closingStock })),
          catalogCreated,
          catalogUpdated,
          catalogFailed,
          catalogMissing,
          placeholderCreated,
          catalogMissingSkus: missingCatalogSkus.slice(0, 200),
          updatedProducts: plans.length,
          deletedProducts: productsToDelete.length,
          storageFilesQueuedForDeletion: storageKeysToDelete.length,
        } as Prisma.InputJsonValue,
      },
    });
    return {
      runId: run.id,
      summary: preview.summary,
      catalogCreated,
      catalogUpdated,
      catalogFailed,
      catalogMissing,
      placeholderCreated,
      updatedProducts: plans.length,
      deletedProducts: productsToDelete.length,
      storageFilesQueuedForDeletion: storageKeysToDelete.length,
    };
  } catch (error) {
    if (stockCommitted) {
      await db.importRun.update({
        where: { id: run.id },
        data: {
          status: "PARTIAL",
          finishedAt: new Date(),
          recordsRead: prepared.parsed.rows.length,
          recordsOk: prepared.parsed.rows.length,
          recordsFail: 1,
          errorMessage: safeMessage(error),
          metadata: {
            sourceType: SOURCE_TYPE,
            fileName: args.fileName,
            reportDate: prepared.parsed.reportDate,
            reason,
            catalogCreated,
            catalogUpdated,
            catalogFailed,
            placeholderCreated,
            failedAfterStockCommit: true,
          } as Prisma.InputJsonValue,
        },
      });
    } else if (catalogCreated || catalogUpdated) {
      await db.importRun.update({
        where: { id: run.id },
        data: {
          status: "PARTIAL",
          finishedAt: new Date(),
          recordsOk: catalogCreated + catalogUpdated,
          recordsFail: Math.max(catalogFailed, 1),
          errorMessage: safeMessage(error),
          errors: catalogErrors.length ? json(catalogErrors) : Prisma.JsonNull,
          metadata: {
            sourceType: SOURCE_TYPE,
            fileName: args.fileName,
            reportDate: prepared.parsed.reportDate,
            reason,
            catalogCreated,
            catalogUpdated,
            catalogFailed,
            placeholderCreated,
            failedBeforeStockCommit: true,
          } as Prisma.InputJsonValue,
        },
      });
    } else {
      await failRun(run.id, error);
    }
    throw error;
  } finally {
    if (leaseAcquired) {
      await releaseSyncLease({ supplierId: supplier.id, runId: run.id, scope: "STOCK" });
    }
  }
}

async function prepareFile(fileName: string, bytes: Uint8Array, now = new Date()) {
  if (!fileName.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Rabalux nedeljni lager mora biti XLSX fajl.");
  }
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) {
    throw new Error("XLSX fajl je prazan ili veći od 15 MB.");
  }
  const parsed = await parseRabaluxWeeklyStockXlsx(bytes);
  parsed.reportDate = parsed.reportDate ?? parseRabaluxStockReportDate(parsed.title, fileName);
  if (parsed.errors.length) {
    throw new Error(`Rabalux XLSX nije prihvaćen: ${parsed.errors.slice(0, 5).join(" ")}`);
  }
  const minimumRows = configuredPositiveInt("RABALUX_WEEKLY_STOCK_MIN_ROWS", 2_000);
  if (parsed.rows.length < minimumRows) {
    throw new Error(
      `Rabalux XLSX ima ${parsed.rows.length} jedinstvenih šifara; očekuje se najmanje ${minimumRows}.`,
    );
  }
  if (!parsed.reportDate) {
    throw new Error("Datum izveštaja nije pronađen u naslovu ili nazivu XLSX fajla.");
  }
  const ageDays = dateDifferenceDays(parsed.reportDate, belgradeDate(now));
  const maximumAgeDays = configuredPositiveInt("RABALUX_WEEKLY_STOCK_MAX_FILE_AGE_DAYS", 14);
  if (ageDays < 0) throw new Error("Datum Rabalux izveštaja je u budućnosti.");
  if (ageDays > maximumAgeDays) {
    throw new Error(
      `Rabalux izveštaj je star ${ageDays} dana; dozvoljeno je najviše ${maximumAgeDays}.`,
    );
  }
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  return {
    parsed,
    fileHash,
    normalizedHash: stableSourceHash(
      parsed.rows.map(({ sourceSku, closingStock }) => ({ sourceSku, closingStock })),
    ),
  };
}

function buildPreview(args: {
  supplierId: string;
  runId: string;
  fileName: string;
  parsed: RabaluxWeeklyStockParseResult;
  products: WeeklyProduct[];
}) {
  const rowsBySku = new Map(args.parsed.rows.map((row) => [row.sourceSku, row] as const));
  const matched = matchRowsToProducts(args.parsed.rows, args.products);
  const observedAt = reportObservationTime(args.parsed.reportDate!);
  const changes: Prisma.SupplierSyncChangeCreateManyInput[] = [];
  const samples: RabaluxWeeklyStockPreviewSummary["samples"] = [];
  let stockChanges = 0;
  let increases = 0;
  let decreases = 0;
  let activations = 0;
  let deactivations = 0;
  let deletions = 0;
  let restores = 0;
  let unchanged = 0;

  for (const product of args.products) {
    const matchedSku = productSourceSku(product, rowsBySku);
    const row = matchedSku ? rowsBySku.get(matchedSku) : undefined;
    if (!row) {
      deletions++;
      if (samples.length < 30) {
        samples.push({
          sourceSku: product.supplierExternalId ?? product.sku,
          name: product.name,
          current: product.supplierStock ?? 0,
          target: 0,
          action: "BRISANJE IZ BAZE",
        });
      }
      changes.push({
        supplierId: args.supplierId,
        importRunId: args.runId,
        productId: product.id,
        externalSku: product.supplierExternalId ?? product.sku,
        changeType: "WEEKLY_CATALOG_DELETE",
        status: "PREVIEW",
        fieldNames: ["product", "media", "attachments"],
        before: json(deletionSnapshot(product)),
        after: Prisma.JsonNull,
        reversible: false,
      });
      continue;
    }
    const plan = stockPlan(product, row, observedAt);
    const current = product.supplierStock ?? 0;
    if (current !== plan.stock) {
      stockChanges++;
      if (plan.stock > current) increases++;
      else decreases++;
    }
    if (!product.isActive && plan.isActive) activations++;
    if (product.isActive && !plan.isActive) deactivations++;
    if (product.deletedAt !== null && plan.deletedAt === null) restores++;
    if (!plan.materialFields.length) {
      unchanged++;
    } else if (samples.length < 30) {
      samples.push({
        sourceSku: matchedSku ?? product.supplierExternalId ?? product.sku,
        name: product.name,
        current,
        target: plan.stock,
        action: previewAction(plan, product),
      });
    }
    if (plan.fields.length) {
      changes.push({
        supplierId: args.supplierId,
        importRunId: args.runId,
        productId: product.id,
        externalSku: matchedSku ?? product.supplierExternalId ?? product.sku,
        changeType: "WEEKLY_STOCK_UPDATE",
        status: "PREVIEW",
        fieldNames: plan.fields,
        before: json(plan.before),
        after: json(plan.after),
        reversible: true,
      });
    }
  }

  const fileOnlyRows = args.parsed.rows.filter(
    (row) => !matched.matchedRowSkus.has(row.sourceSku),
  );
  for (const row of fileOnlyRows) {
    changes.push({
      supplierId: args.supplierId,
      importRunId: args.runId,
      externalSku: row.sourceSku,
      changeType: "CATALOG_CREATE_FROM_WEEKLY_STOCK",
      status: "PREVIEW",
      fieldNames: ["product", "supplierStock"],
      before: Prisma.JsonNull,
      after: json({
        supplierStock: row.closingStock,
        visibleCandidate: row.closingStock > 0,
        purchaseCandidate: row.closingStock >= RABALUX_PUBLIC_STOCK_THRESHOLD,
      }),
      reversible: true,
    });
    if (samples.length < 30) {
      samples.push({
        sourceSku: row.sourceSku,
        name: row.name,
        current: 0,
        target: row.closingStock,
        action: "NOV PROIZVOD IZ KATALOGA",
      });
    }
  }

  const positiveSkus = args.parsed.rows.filter((row) => row.closingStock > 0).length;
  const activeThresholdSkus = args.parsed.rows.filter(
    (row) => row.closingStock >= RABALUX_PUBLIC_STOCK_THRESHOLD,
  ).length;
  const summary: RabaluxWeeklyStockPreviewSummary = {
    fileName: args.fileName,
    sheetName: args.parsed.sheetName,
    reportDate: args.parsed.reportDate!,
    title: args.parsed.title,
    validRows: args.parsed.validRows,
    uniqueSkus: args.parsed.rows.length,
    duplicateRows: args.parsed.duplicateRows,
    ignoredRows: args.parsed.ignoredRows,
    totalUnits: args.parsed.rows.reduce((sum, row) => sum + row.closingStock, 0),
    positiveSkus,
    lowStockSkus: positiveSkus - activeThresholdSkus,
    activeThresholdSkus,
    zeroStockSkus: args.parsed.rows.length - positiveSkus,
    matchedSkus: matched.matchedRowSkus.size,
    fileOnlySkus: fileOnlyRows.length,
    fileOnlyPositiveSkus: fileOnlyRows.filter((row) => row.closingStock > 0).length,
    fileOnlyActiveThresholdSkus: fileOnlyRows.filter(
      (row) => row.closingStock >= RABALUX_PUBLIC_STOCK_THRESHOLD,
    ).length,
    siteOnlyProducts: args.products.filter(
      (product) => !matched.matchedProductIds.has(product.id),
    ).length,
    stockChanges,
    increases,
    decreases,
    activations,
    deactivations,
    deletions,
    storageFilesToDelete: managedStorageKeys(
      args.products.filter((product) => !matched.matchedProductIds.has(product.id)),
    ).length,
    restores,
    unchanged,
    samples,
  };
  return { summary, changes };
}

function stockPlan(
  product: WeeklyProduct,
  row: RabaluxWeeklyStockRow,
  observedAt: Date,
) {
  const stock = row.closingStock;
  const policy = resolveRabaluxWeeklyStockPolicy({
    closingStock: stock,
    supplierApprovalStatus: product.supplierApprovalStatus,
    articleStatus: product.articleStatus,
    hasCategory: product.categories.length > 0,
    hasReadyImage: product.media.some(
      (asset) => asset.kind === "IMAGE" && asset.syncStatus === "READY",
    ),
    hasActiveRetailPrice: product.priceListEntries.length > 0,
  });
  const deletedAt = null;
  const isActive = policy.isActive;
  const availableWebAuto = policy.availableWebAuto;
  const before = {
    supplierStock: product.supplierStock,
    supplierNextArrivalAt: product.supplierNextArrivalAt?.toISOString() ?? null,
    lastSupplierStockSyncAt: product.lastSupplierStockSyncAt?.toISOString() ?? null,
    isDtz: product.isDtz,
    isActive: product.isActive,
    availableWebAuto: product.availableWebAuto,
    deletedAt: product.deletedAt?.toISOString() ?? null,
  };
  const after = {
    supplierStock: stock,
    supplierNextArrivalAt: null,
    lastSupplierStockSyncAt: observedAt.toISOString(),
    isDtz: false,
    isActive,
    availableWebAuto,
    deletedAt: null,
  };
  const fields = changedFields(before, after);
  const materialFields = fields.filter((field) => field !== "lastSupplierStockSyncAt");
  return {
    product,
    matchedSku: row.sourceSku,
    stock,
    isActive,
    availableWebAuto,
    deletedAt,
    before,
    after,
    fields,
    materialFields,
  };
}

function matchRowsToProducts(rows: RabaluxWeeklyStockRow[], products: WeeklyProduct[]) {
  const rowBySku = new Map(rows.map((row) => [row.sourceSku, row] as const));
  const matchedRowSkus = new Set<string>();
  const matchedProductIds = new Set<string>();
  for (const product of products) {
    const sourceSku = productSourceSku(product, rowBySku);
    if (!sourceSku) continue;
    matchedRowSkus.add(sourceSku);
    matchedProductIds.add(product.id);
  }
  return { matchedRowSkus, matchedProductIds };
}

function productSourceSku(
  product: Pick<WeeklyProduct, "supplierExternalId" | "sku">,
  rowBySku: ReadonlyMap<string, unknown>,
) {
  if (product.supplierExternalId && rowBySku.has(product.supplierExternalId)) {
    return product.supplierExternalId;
  }
  const sourceSku = product.sku.startsWith("RAB-") ? product.sku.slice(4) : null;
  if (sourceSku && product.sku === rabaluxSku(sourceSku) && rowBySku.has(sourceSku)) {
    return sourceSku;
  }
  return null;
}

async function loadWeeklyProducts(supplierId: string) {
  return db.product.findMany({
    where: { supplierId },
    select: {
      id: true,
      sku: true,
      name: true,
      supplierExternalId: true,
      supplierStock: true,
      supplierReservedStock: true,
      supplierNextArrivalAt: true,
      lastSupplierStockSyncAt: true,
      dcAvailableQty: true,
      availableWebAuto: true,
      articleStatus: true,
      isDtz: true,
      isActive: true,
      deletedAt: true,
      supplierApprovalStatus: true,
      categories: { select: { categoryId: true }, take: 1 },
      media: {
        select: {
          id: true,
          kind: true,
          syncStatus: true,
          url: true,
          thumbUrl: true,
          cardUrl: true,
          pdpUrl: true,
        },
      },
      attachments: {
        select: { id: true, url: true },
      },
      priceListEntries: {
        where: activeRetailPriceEntryWhere(),
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { id: "asc" },
  });
}

async function createWeeklyStockPlaceholders(args: {
  supplierId: string;
  rows: RabaluxWeeklyStockRow[];
  observedAt: Date;
  now: Date;
  runId: string;
  reason: string;
  actorId: string;
}) {
  let created = 0;
  for (const rows of chunk(args.rows, 250)) {
    const result = await db.product.createMany({
      data: rows.map((row) => ({
        sku: rabaluxSku(row.sourceSku),
        slug: slugifyRabalux(row.name, row.sourceSku),
        name: row.name || `Rabalux ${row.sourceSku}`,
        description: row.name || `Rabalux artikal ${row.sourceSku}`,
        fullPrice: new Prisma.Decimal(0),
        supplierId: args.supplierId,
        supplierExternalId: row.sourceSku,
        supplierStock: row.closingStock,
        isDtz: false,
        isActive: false,
        availableWebAuto: false,
        supplierApprovalStatus: "PENDING_MAPPING",
        supplierCatalogMissingCount: 0,
        supplierCatalogMissingSince: null,
        supplierStockMissingCount: 0,
        supplierStockMissingSince: null,
        lastSupplierStockSyncAt: args.observedAt,
        lastSupplierSyncAt: args.now,
        lastSupplierSourceHash: stableSourceHash({
          source: SOURCE_TYPE,
          placeholder: true,
          sourceSku: row.sourceSku,
          name: row.name,
        }),
      })),
      skipDuplicates: true,
    });
    created += result.count;
  }

  if (!created) return 0;
  const products = await db.product.findMany({
    where: {
      supplierId: args.supplierId,
      supplierExternalId: { in: args.rows.map((row) => row.sourceSku) },
    },
    select: { id: true, supplierExternalId: true, name: true },
  });
  const rowBySku = new Map(args.rows.map((row) => [row.sourceSku, row] as const));
  for (const productBatch of chunk(products, 500)) {
    await db.supplierSyncChange.createMany({
      data: productBatch.map((product) => ({
        supplierId: args.supplierId,
        importRunId: args.runId,
        productId: product.id,
        externalSku: product.supplierExternalId!,
        changeType: "CATALOG_CREATE_FROM_WEEKLY_STOCK",
        status: "APPLIED" as const,
        fieldNames: ["product", "supplierStock"],
        before: Prisma.JsonNull,
        after: json({
          name: product.name,
          supplierStock: rowBySku.get(product.supplierExternalId!)?.closingStock ?? 0,
          placeholder: true,
          requiresCatalogEnrichment: true,
        }),
        reversible: true,
        reason: args.reason,
        appliedAt: args.now,
        reviewedById: args.actorId,
      })),
    });
  }
  return created;
}

function weeklyStateHash(products: WeeklyProduct[]) {
  return stableSourceHash(
    products.map((product) => ({
      id: product.id,
      supplierExternalId: product.supplierExternalId,
      supplierStock: product.supplierStock,
      dcAvailableQty: product.dcAvailableQty,
      articleStatus: product.articleStatus,
      supplierApprovalStatus: product.supplierApprovalStatus,
      isActive: product.isActive,
      availableWebAuto: product.availableWebAuto,
      deletedAt: product.deletedAt,
      readyCategory: product.categories.length > 0,
      readyMedia: product.media.some(
        (asset) => asset.kind === "IMAGE" && asset.syncStatus === "READY",
      ),
      managedMediaKeys: managedStorageKeys([product]),
      readyPrice: product.priceListEntries.length > 0,
    })),
  );
}

function managedStorageKeys(products: WeeklyProduct[]) {
  return Array.from(
    new Set(
      products.flatMap((product) => [
        ...product.media.flatMap((asset) =>
          getManagedProductMediaStorageKeys(asset),
        ),
        ...product.attachments.flatMap((asset) =>
          getManagedProductMediaStorageKeys(asset),
        ),
      ]),
    ),
  ).sort();
}

function deletionSnapshot(product: WeeklyProduct) {
  return {
    id: product.id,
    sku: product.sku,
    supplierExternalId: product.supplierExternalId,
    name: product.name,
    supplierStock: product.supplierStock,
    dcAvailableQty: product.dcAvailableQty,
    mediaRows: product.media.length,
    attachmentRows: product.attachments.length,
    storageFiles: managedStorageKeys([product]).length,
  };
}

function chunk<T>(values: T[], size: number) {
  const batches: T[][] = [];
  for (let start = 0; start < values.length; start += size) {
    batches.push(values.slice(start, start + size));
  }
  return batches;
}

async function consumePreview(args: {
  actorId: string;
  supplierId: string;
  token: string;
  fileHash: string;
  stateHash: string;
  reason: string;
}) {
  const [runId] = args.token.split(".", 1);
  if (!runId || args.token.length > 200) throw new Error("Preview potvrda nije važeća.");
  const consumed = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "ImportRun"
       SET "metadata" = "metadata" || jsonb_build_object(
         'consumedAt', NOW()::text,
         'reason', ${args.reason}::text
       )
     WHERE "id" = ${runId}
       AND "supplierId" = ${args.supplierId}
       AND "dryRun" = TRUE
       AND "kind" = 'STOCK'
       AND "sourceHash" = ${args.fileHash}
       AND "metadata"->>'sourceType' = ${SOURCE_TYPE}
       AND "metadata"->>'actorId' = ${args.actorId}
       AND "metadata"->>'stateHash' = ${args.stateHash}
       AND "metadata"->>'tokenHash' = ${hashToken(args.token)}
       AND "metadata"->>'consumedAt' IS NULL
       AND ("metadata"->>'expiresAt')::timestamptz > NOW()
    RETURNING "id"
  `);
  if (consumed.length !== 1) {
    throw new Error(
      "Preview je istekao, već je iskorišćen, fajl je promenjen ili je Rabalux stanje promenjeno nakon pregleda.",
    );
  }
  return { previewRunId: consumed[0].id };
}

async function assertNotAlreadyApplied(supplierId: string, fileHash: string) {
  const candidates = await db.importRun.findMany({
    where: {
      supplierId,
      kind: "STOCK",
      dryRun: false,
      sourceHash: fileHash,
      status: { in: ["SUCCESS", "PARTIAL"] },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, metadata: true },
  });
  const existing = candidates.find((run) => {
    if (run.status === "SUCCESS") return true;
    const metadata =
      run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
        ? (run.metadata as Record<string, Prisma.JsonValue>)
        : null;
    if (metadata?.failedBeforeStockCommit === true) return false;
    const catalogMissing =
      typeof metadata?.catalogMissing === "number" ? metadata.catalogMissing : 0;
    return catalogMissing <= 0;
  });
  if (existing) {
    throw new Error(`Ovaj identičan Rabalux XLSX je već primenjen (run ${existing.id}).`);
  }
}

async function assertWeeklyBaseline(supplierId: string, rows: number) {
  const candidates = await db.importRun.findMany({
    where: {
      supplierId,
      kind: "STOCK",
      dryRun: false,
      status: { in: ["SUCCESS", "PARTIAL"] },
      metadata: { path: ["sourceType"], equals: SOURCE_TYPE },
    },
    orderBy: { finishedAt: "desc" },
    select: { recordsRead: true, metadata: true },
  });
  const previous = candidates.find((run) =>
    isCommittedRabaluxWeeklyStockMetadata(run.metadata),
  );
  if (!previous?.recordsRead) return;
  const ratio = configuredRatio("RABALUX_WEEKLY_STOCK_MIN_BASELINE_RATIO", 0.7);
  const minimum = Math.ceil(previous.recordsRead * ratio);
  if (rows < minimum) {
    throw new Error(
      `Rabalux XLSX je pao sa ${previous.recordsRead} na ${rows} šifara; sigurnosni minimum je ${minimum}.`,
    );
  }
}

async function assertReportDateNotOlder(supplierId: string, reportDate: string) {
  const candidates = await db.importRun.findMany({
    where: {
      supplierId,
      kind: "STOCK",
      dryRun: false,
      status: { in: ["SUCCESS", "PARTIAL"] },
      metadata: { path: ["sourceType"], equals: SOURCE_TYPE },
    },
    orderBy: { finishedAt: "desc" },
    select: { metadata: true },
  });
  const previous = candidates.find((run) =>
    isCommittedRabaluxWeeklyStockMetadata(run.metadata),
  );
  const metadata =
    previous?.metadata &&
    typeof previous.metadata === "object" &&
    !Array.isArray(previous.metadata)
      ? (previous.metadata as Record<string, Prisma.JsonValue>)
      : null;
  const previousDate =
    typeof metadata?.reportDate === "string" ? metadata.reportDate : null;
  if (previousDate && reportDate < previousDate) {
    throw new Error(
      `Rabalux izveštaj ${reportDate} je stariji od već primenjenog izveštaja ${previousDate}.`,
    );
  }
}

async function getOperationalSupplier(): Promise<Supplier> {
  const supplier = await db.supplier.findUnique({
    where: { integrationKey: RABALUX_INTEGRATION_KEY },
  });
  if (!supplier) throw new Error("Rabalux dobavljač nije podešen.");
  if (!isRabaluxSupplierOperational(supplier)) {
    throw new Error("Rabalux integracija je isključena.");
  }
  return supplier;
}

async function failRun(runId: string, error: unknown) {
  await db.importRun.update({
    where: { id: runId },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      recordsFail: 1,
      errorMessage: safeMessage(error),
    },
  });
}

function previewAction(
  plan: ReturnType<typeof stockPlan>,
  product: WeeklyProduct,
) {
  if (product.deletedAt !== null && plan.deletedAt === null) return "VRAĆANJE";
  if (product.isActive && !plan.isActive) return "DEAKTIVACIJA";
  if (!product.isActive && plan.isActive) return "AKTIVACIJA";
  return "PROMENA STANJA";
}

function changedFields(left: Record<string, unknown>, right: Record<string, unknown>) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
    (key) => stableSourceHash(left[key]) !== stableSourceHash(right[key]),
  );
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function belgradeDate(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Belgrade",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dateDifferenceDays(earlier: string, later: string) {
  return Math.round(
    (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) /
      (24 * 60 * 60 * 1_000),
  );
}

function reportObservationTime(reportDate: string) {
  return new Date(`${reportDate}T12:00:00.000Z`);
}

function json(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null
    ? Prisma.JsonNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 1_000);
}
