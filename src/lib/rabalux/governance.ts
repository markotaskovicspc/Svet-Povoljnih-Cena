import "server-only";

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseOverrideFields } from "./ownership";
import { rabaluxMediaStorageKey } from "./parser";
import {
  acquireSyncLease,
  releaseSyncLease,
  stableSourceHash,
  type RabaluxSyncScope,
} from "./safety";
import { RABALUX_INTEGRATION_KEY } from "./config";

export async function saveRabaluxCategoryMapping(args: {
  externalCategory: string;
  externalType: string;
  categoryId: string;
  actorId: string;
}) {
  const externalCategory = args.externalCategory.trim();
  const externalType = args.externalType.trim();
  if (!externalCategory || !externalType || !args.categoryId) {
    throw new Error("Dobavljačka kategorija, tip i interna kategorija su obavezni.");
  }
  if (externalCategory.length > 250 || externalType.length > 250) {
    throw new Error("Naziv dobavljačke kategorije ili tipa je predugačak.");
  }
  const supplier = await rabaluxSupplier();
  await db.category.findUniqueOrThrow({ where: { id: args.categoryId } });
  const mapping = await db.supplierCategoryMapping.upsert({
    where: {
      supplierId_externalCategory_externalType: {
        supplierId: supplier.id,
        externalCategory,
        externalType,
      },
    },
    create: {
      supplierId: supplier.id,
      externalCategory,
      externalType,
      categoryId: args.categoryId,
      enabled: true,
      createdById: args.actorId,
    },
    update: {
      categoryId: args.categoryId,
      enabled: true,
      createdById: args.actorId,
    },
  });
  const unresolved = await db.supplierSyncChange.findMany({
    where: {
      supplierId: supplier.id,
      changeType: "MAPPING_REQUIRED",
      status: "CONFLICT",
      AND: [
        { after: { path: ["category"], equals: externalCategory } },
        { after: { path: ["type"], equals: externalType } },
      ],
    },
    select: { id: true, productId: true },
  });
  const productIds = unresolved
    .map(({ productId }) => productId)
    .filter((id): id is string => Boolean(id));
  await db.$transaction(async (tx) => {
    for (const productId of productIds) {
      await tx.productCategory.deleteMany({ where: { productId } });
      await tx.productCategory.create({
        data: { productId, categoryId: args.categoryId },
      });
    }
    if (productIds.length) {
      await tx.product.updateMany({
        where: { id: { in: productIds }, supplierId: supplier.id },
        data: {
          supplierApprovalStatus: "PENDING_APPROVAL",
          isActive: false,
        },
      });
    }
    await tx.supplierSyncChange.updateMany({
      where: { id: { in: unresolved.map(({ id }) => id) } },
      data: {
        status: "APPLIED",
        appliedAt: new Date(),
        reviewedById: args.actorId,
        reason: "Category mapping approved by administrator.",
      },
    });
  });
  return { mappingId: mapping.id, affectedProducts: productIds.length };
}

export async function reviewRabaluxProduct(args: {
  productId: string;
  actorId: string;
  decision: "APPROVE" | "REJECT";
  reason: string;
}) {
  const reason = validatedReason(args.reason);
  const product = await db.product.findFirst({
    where: {
      id: args.productId,
      supplier: { integrationKey: RABALUX_INTEGRATION_KEY },
    },
    select: {
      id: true,
      supplierId: true,
      supplierExternalId: true,
      supplierApprovalStatus: true,
      isActive: true,
      fullPrice: true,
      articleStatus: true,
      categories: { select: { categoryId: true }, take: 1 },
      media: {
        where: { kind: "IMAGE", syncStatus: "READY" },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!product?.supplierId || !product.supplierExternalId) {
    throw new Error("Rabalux proizvod nije pronađen.");
  }
  const approve = args.decision === "APPROVE";
  if (approve) {
    if (!product.categories.length) throw new Error("Proizvod nema mapiranu kategoriju.");
    if (Number(product.fullPrice) <= 0) throw new Error("Proizvod nema validnu cenu.");
    if (!product.media.length) throw new Error("Proizvod nema spremnu fotografiju.");
  }
  const isActive =
    approve &&
    product.articleStatus !== "ARH" &&
    Number(product.fullPrice) > 0 &&
    product.categories.length > 0 &&
    product.media.length > 0;
  const governanceRun = await createGovernanceRun({
    supplierId: product.supplierId,
    actorId: args.actorId,
    action: `PRODUCT_${args.decision}`,
    reason,
  });
  await db.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: {
        supplierApprovalStatus: approve ? "APPROVED" : "REJECTED",
        supplierApprovedAt: approve ? new Date() : null,
        supplierApprovedById: approve ? args.actorId : null,
        isActive,
      },
    });
    await tx.supplierSyncChange.create({
      data: {
        supplierId: product.supplierId!,
        importRunId: governanceRun.id,
        productId: product.id,
        externalSku: product.supplierExternalId!,
        changeType: `PRODUCT_${args.decision}`,
        status: "APPLIED",
        fieldNames: ["supplierApprovalStatus", "isActive"],
        before: {
          supplierApprovalStatus: product.supplierApprovalStatus,
          isActive: product.isActive,
        },
        after: {
          supplierApprovalStatus: approve ? "APPROVED" : "REJECTED",
          isActive,
        },
        appliedAt: new Date(),
        reviewedById: args.actorId,
        reason,
      },
    });
  });
  await finishGovernanceRun(governanceRun.id);
  return { productId: product.id, status: approve ? "APPROVED" : "REJECTED" };
}

export async function reviewRabaluxPriceProposal(args: {
  changeId: string;
  actorId: string;
  decision: "APPROVE" | "REJECT";
  reason: string;
}) {
  const reason = validatedReason(args.reason);
  const proposal = await db.supplierSyncChange.findFirst({
    where: {
      id: args.changeId,
      changeType: "PRICE_PROPOSAL",
      status: "PENDING",
      supplier: { integrationKey: RABALUX_INTEGRATION_KEY },
    },
    include: {
      product: { select: { id: true, syncOverrides: true } },
    },
  });
  if (!proposal?.product) throw new Error("Predlog cene više nije dostupan.");
  if (args.decision === "REJECT") {
    await db.supplierSyncChange.update({
      where: { id: proposal.id },
      data: { status: "SKIPPED", reviewedById: args.actorId, reason },
    });
    return { changeId: proposal.id, status: "SKIPPED" };
  }
  const locks = parseOverrideFields(proposal.product.syncOverrides);
  if (locks.has("pricing") || locks.has("price")) {
    throw new Error("Cena je ručno zaključana. Uklonite XML zaštitu pre odobrenja.");
  }
  const after = jsonObject(proposal.after);
  const fullPrice = numberValue(after.fullPrice);
  const salePrice = nullableNumberValue(after.salePrice);
  const discountPct = nullableIntegerValue(after.discountPct);
  if (fullPrice <= 0 || (salePrice != null && salePrice >= fullPrice)) {
    throw new Error("Predložena cena nije validna.");
  }
  await db.$transaction([
    db.product.update({
      where: { id: proposal.product.id },
      data: { fullPrice, salePrice, discountPct },
    }),
    db.supplierSyncChange.update({
      where: { id: proposal.id },
      data: {
        status: "APPLIED",
        appliedAt: new Date(),
        reviewedById: args.actorId,
        reason,
      },
    }),
  ]);
  return { changeId: proposal.id, status: "APPLIED" };
}

export async function rollbackRabaluxRun(args: {
  importRunId: string;
  actorId: string;
  reason: string;
}) {
  const reason = validatedReason(args.reason);
  const original = await db.importRun.findFirst({
    where: {
      id: args.importRunId,
      dryRun: false,
      supplier: { integrationKey: RABALUX_INTEGRATION_KEY },
      status: { in: ["SUCCESS", "PARTIAL"] },
    },
    select: { id: true, supplierId: true, kind: true },
  });
  if (!original || original.kind === "GENERIC") {
    throw new Error("Run nije dostupan za Rabalux rollback.");
  }
  const run = await db.importRun.create({
    data: {
      supplierId: original.supplierId,
      kind: original.kind,
      status: "RUNNING",
      requestedById: args.actorId,
      rollbackOfId: original.id,
      metadata: { reason },
    },
  });
  const scope = original.kind as RabaluxSyncScope;
  let leaseAcquired = false;
  let applied = 0;
  let conflicts = 0;
  const errors: Array<{ changeId: string; message: string }> = [];
  try {
    await acquireSyncLease({
      supplierId: original.supplierId,
      runId: run.id,
      scope,
    });
    leaseAcquired = true;
    const changes = await db.supplierSyncChange.findMany({
      where: {
        importRunId: original.id,
        status: "APPLIED",
        reversible: true,
        productId: { not: null },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10_000,
    });
    for (const change of changes) {
      try {
        const outcome = await rollbackChange({
          change,
          rollbackRunId: run.id,
          actorId: args.actorId,
          reason,
        });
        if (outcome === "CONFLICT") conflicts++;
        else applied++;
      } catch (error) {
        errors.push({
          changeId: change.id,
          message: error instanceof Error ? error.message.slice(0, 500) : String(error),
        });
      }
    }
    const status = errors.length || conflicts ? (applied ? "PARTIAL" : "FAILED") : "SUCCESS";
    await db.importRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        recordsRead: changes.length,
        recordsOk: applied,
        recordsFail: errors.length + conflicts,
        errors: errors.length ? errors : Prisma.JsonNull,
        errorMessage: errors[0]?.message ?? (conflicts ? "Rollback conflicts require review." : null),
        metadata: { reason, conflicts },
      },
    });
    return { runId: run.id, applied, conflicts, failed: errors.length };
  } catch (error) {
    await db.importRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        recordsFail: Math.max(errors.length, 1),
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : String(error),
      },
    });
    throw error;
  } finally {
    if (leaseAcquired) {
      await releaseSyncLease({
        supplierId: original.supplierId,
        runId: run.id,
        scope,
      });
    }
  }
}

async function rollbackChange(args: {
  change: Awaited<ReturnType<typeof db.supplierSyncChange.findMany>>[number];
  rollbackRunId: string;
  actorId: string;
  reason: string;
}) {
  const productId = args.change.productId!;
  const newer = await db.supplierSyncChange.findFirst({
    where: {
      productId,
      importRunId: { notIn: [args.change.importRunId, args.rollbackRunId] },
      status: "APPLIED",
      revertedAt: null,
      createdAt: { gt: args.change.createdAt },
      fieldNames: { hasSome: args.change.fieldNames },
    },
    select: { id: true },
  });
  const current = await productRollbackSnapshot(productId);
  const after = jsonObject(args.change.after);
  const before = jsonObject(args.change.before);
  const drifted =
    Boolean(newer) ||
    (args.change.changeType !== "CREATE" &&
      args.change.fieldNames.some(
        (field) => stableSourceHash(current[field]) !== stableSourceHash(after[field]),
      ));
  if (drifted) {
    await db.supplierSyncChange.create({
      data: {
        supplierId: args.change.supplierId,
        importRunId: args.rollbackRunId,
        productId,
        externalSku: args.change.externalSku,
        changeType: "ROLLBACK_CONFLICT",
        status: "CONFLICT",
        fieldNames: args.change.fieldNames,
        before: snapshotJson(current),
        after: args.change.before ?? Prisma.JsonNull,
        reversible: false,
        reviewedById: args.actorId,
        reason: "Product changed after the original run; rollback skipped.",
      },
    });
    return "CONFLICT" as const;
  }
  await db.$transaction(async (tx) => {
    if (args.change.changeType === "CREATE") {
      await tx.product.update({
        where: { id: productId },
        data: {
          isActive: false,
          supplierApprovalStatus: "REJECTED",
          supplierApprovedAt: null,
          supplierApprovedById: null,
        },
      });
    } else {
      const scalarData = rollbackScalarData(before, args.change.fieldNames);
      if (Object.keys(scalarData).length) {
        await tx.product.update({ where: { id: productId }, data: scalarData });
      }
      if (args.change.fieldNames.includes("categories")) {
        const categoryIds = relationIds(before.categories, "categoryId");
        await tx.productCategory.deleteMany({ where: { productId } });
        if (categoryIds.length) {
          await tx.productCategory.createMany({
            data: categoryIds.map((categoryId) => ({ productId, categoryId })),
          });
        }
      }
      if (args.change.fieldNames.includes("media")) {
        await restoreMedia(tx, productId, args.change.externalSku, before.media);
      }
      if (args.change.fieldNames.includes("attachments")) {
        await restoreAttachments(
          tx,
          productId,
          args.change.externalSku,
          before.attachments,
        );
      }
    }
    const restored = await productRollbackSnapshot(productId, tx);
    await tx.supplierSyncChange.update({
      where: { id: args.change.id },
      data: {
        status: "REVERTED",
        revertedAt: new Date(),
        reviewedById: args.actorId,
        reason: args.reason,
      },
    });
    await tx.supplierSyncChange.create({
      data: {
        supplierId: args.change.supplierId,
        importRunId: args.rollbackRunId,
        productId,
        externalSku: args.change.externalSku,
        changeType: "ROLLBACK_APPLIED",
        status: "APPLIED",
        fieldNames: args.change.fieldNames,
        before: snapshotJson(current),
        after: snapshotJson(restored),
        reversible: false,
        appliedAt: new Date(),
        reviewedById: args.actorId,
        reason: args.reason,
      },
    });
  });
  return "APPLIED" as const;
}

async function productRollbackSnapshot(
  productId: string,
  client: Prisma.TransactionClient | typeof db = db,
) {
  const product = await client.product.findUniqueOrThrow({
    where: { id: productId },
    include: {
      categories: { orderBy: { categoryId: "asc" }, select: { categoryId: true } },
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
  return jsonObject(snapshotJson(product));
}

function rollbackScalarData(before: Record<string, unknown>, fields: string[]) {
  const allowed = new Set([
    "sku",
    "barcode",
    "slug",
    "name",
    "description",
    "shortDescription",
    "colorPrimary",
    "colorSecondary",
    "groupId",
    "widthCm",
    "depthCm",
    "heightCm",
    "weightKg",
    "grossWeightKg",
    "packWidthCm",
    "packDepthCm",
    "packHeightCm",
    "packGrossWeightKg",
    "fullPrice",
    "salePrice",
    "discountPct",
    "technicalSpecs",
    "warrantyYears",
    "countryOfOrigin",
    "hsCode",
    "isNew",
    "isActive",
    "articleStatus",
    "supplierApprovalStatus",
    "supplierStock",
    "supplierNextArrivalAt",
    "isDtz",
  ]);
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    if (!allowed.has(field) || !(field in before)) continue;
    if (field === "technicalSpecs" && before[field] == null) {
      data[field] = Prisma.JsonNull;
    } else if (field === "supplierNextArrivalAt") {
      data[field] =
        typeof before[field] === "string" ? new Date(before[field]) : before[field];
    } else {
      data[field] = before[field];
    }
  }
  return data as Prisma.ProductUncheckedUpdateInput;
}

async function restoreMedia(
  tx: Prisma.TransactionClient,
  productId: string,
  externalSku: string,
  value: unknown,
) {
  const assets = arrayObjects(value);
  await tx.productMedia.deleteMany({ where: { productId } });
  if (!assets.length) return;
  await tx.productMedia.createMany({
    data: assets
      .filter((asset) => typeof asset.sourceUrl === "string")
      .map((asset) => ({
        productId,
        sourceUrl: String(asset.sourceUrl),
        kind: String(asset.kind) as "IMAGE" | "VIDEO" | "VIDEO_3D",
        order: Number(asset.order) || 0,
        syncStatus: String(asset.syncStatus ?? "PENDING") as
          | "READY"
          | "PENDING"
          | "FAILED",
        url: rabaluxMediaStorageKey(externalSku, String(asset.sourceUrl), "original"),
      })),
  });
}

async function restoreAttachments(
  tx: Prisma.TransactionClient,
  productId: string,
  externalSku: string,
  value: unknown,
) {
  const assets = arrayObjects(value);
  await tx.productAttachment.deleteMany({ where: { productId } });
  if (!assets.length) return;
  await tx.productAttachment.createMany({
    data: assets
      .filter((asset) => typeof asset.sourceUrl === "string")
      .map((asset) => ({
        productId,
        sourceUrl: String(asset.sourceUrl),
        kind: String(asset.kind) as "MANUAL" | "ENERGY_LABEL",
        label:
          asset.kind === "ENERGY_LABEL" ? "Energetska oznaka" : "Uputstvo",
        order: Number(asset.order) || 0,
        syncStatus: String(asset.syncStatus ?? "PENDING") as
          | "READY"
          | "PENDING"
          | "FAILED",
        url: rabaluxMediaStorageKey(externalSku, String(asset.sourceUrl), "documents"),
      })),
  });
}

async function createGovernanceRun(args: {
  supplierId: string;
  actorId: string;
  action: string;
  reason: string;
}) {
  return db.importRun.create({
    data: {
      supplierId: args.supplierId,
      kind: "CATALOG",
      status: "RUNNING",
      requestedById: args.actorId,
      metadata: { governanceAction: args.action, reason: args.reason },
    },
  });
}

async function finishGovernanceRun(runId: string) {
  await db.importRun.update({
    where: { id: runId },
    data: {
      status: "SUCCESS",
      finishedAt: new Date(),
      recordsRead: 1,
      recordsOk: 1,
    },
  });
}

async function rabaluxSupplier() {
  return db.supplier.findUniqueOrThrow({
    where: { integrationKey: RABALUX_INTEGRATION_KEY },
    select: { id: true },
  });
}

function validatedReason(value: string) {
  const reason = value.trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new Error("Razlog mora imati između 5 i 500 znakova.");
  }
  return reason;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function snapshotJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function arrayObjects(value: unknown) {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function relationIds(value: unknown, key: string) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      typeof item === "string"
        ? item
        : item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)[key]
          : null,
    )
    .filter((id): id is string => typeof id === "string");
}

function numberValue(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Predložena cena nije broj.");
  return number;
}

function nullableNumberValue(value: unknown) {
  return value == null ? null : numberValue(value);
}

function nullableIntegerValue(value: unknown) {
  if (value == null) return null;
  const number = numberValue(value);
  if (!Number.isInteger(number)) throw new Error("Predloženi popust nije ceo broj.");
  return number;
}
