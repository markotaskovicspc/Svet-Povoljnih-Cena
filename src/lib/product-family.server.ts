import "server-only";

import { Prisma } from "@prisma/client";
import {
  normalizeProductFamilyCode,
  normalizeProductFamilyHex,
  normalizeProductFamilyLabel,
  productFamilyLabelKey,
} from "@/lib/product-family";
import { productAttachmentAdminLabel } from "@/lib/product-documents";

export type ProductFamilySyncGroup = "master" | "commercial";

async function lockFamily(tx: Prisma.TransactionClient, familyId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`spc:product-family:${familyId}`}))::text AS "lock"`;
}

export async function normalizeProductFamilyPrimary(
  tx: Prisma.TransactionClient,
  familyId: string,
  preferredProductId?: string | null,
) {
  await lockFamily(tx, familyId);
  const family = await tx.productFamily.findUnique({
    where: { id: familyId },
    select: {
      primaryProductId: true,
      members: {
        orderBy: [{ position: "asc" }, { productId: "asc" }],
        select: { productId: true },
      },
    },
  });
  if (!family) return null;
  const memberIds = new Set(family.members.map((member) => member.productId));
  const nextPrimary =
    (preferredProductId && memberIds.has(preferredProductId) ? preferredProductId : null) ??
    (family.primaryProductId && memberIds.has(family.primaryProductId)
      ? family.primaryProductId
      : null) ??
    family.members[0]?.productId ??
    null;
  await tx.productFamily.update({
    where: { id: familyId },
    data: { primaryProductId: nextPrimary },
  });
  return nextPrimary;
}

export async function setProductFamilyMembership(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    familyCode?: string | null;
    label?: string | null;
    colorHex?: string | null;
    position?: number | null;
    storefrontEnabled?: boolean | null;
    makePrimary?: boolean;
  },
) {
  const current = await tx.productFamilyMember.findUnique({
    where: { productId: input.productId },
    select: { familyId: true },
  });
  const rawCode = input.familyCode?.trim() ?? "";
  if (!rawCode) {
    if (!current) return null;
    await lockFamily(tx, current.familyId);
    await tx.productFamilyMember.delete({ where: { productId: input.productId } });
    const remaining = await tx.productFamilyMember.count({
      where: { familyId: current.familyId },
    });
    if (!remaining) {
      await tx.productFamily.delete({ where: { id: current.familyId } });
      return null;
    }
    await normalizeProductFamilyPrimary(tx, current.familyId);
    return null;
  }

  const code = normalizeProductFamilyCode(rawCode);
  const label = normalizeProductFamilyLabel(input.label ?? "");
  const labelKey = productFamilyLabelKey(label);
  const colorHex = normalizeProductFamilyHex(input.colorHex);
  const family = await tx.productFamily.upsert({
    where: { code },
    create: { code },
    update: {},
    select: { id: true, primaryProductId: true },
  });
  await lockFamily(tx, family.id);

  const member = await tx.productFamilyMember.upsert({
    where: { productId: input.productId },
    create: {
      productId: input.productId,
      familyId: family.id,
      label,
      labelKey,
      colorHex,
      position: Math.max(0, Math.trunc(input.position ?? 0)),
      storefrontEnabled: input.storefrontEnabled ?? true,
    },
    update: {
      familyId: family.id,
      label,
      labelKey,
      colorHex,
      position:
        input.position == null ? undefined : Math.max(0, Math.trunc(input.position)),
      storefrontEnabled: input.storefrontEnabled ?? undefined,
    },
  });

  if (current && current.familyId !== family.id) {
    const oldCount = await tx.productFamilyMember.count({
      where: { familyId: current.familyId },
    });
    if (!oldCount) await tx.productFamily.delete({ where: { id: current.familyId } });
    else await normalizeProductFamilyPrimary(tx, current.familyId);
  }
  await normalizeProductFamilyPrimary(
    tx,
    family.id,
    input.makePrimary || !family.primaryProductId ? input.productId : undefined,
  );
  return member;
}

export async function getProductFamilyProductIds(
  tx: Prisma.TransactionClient,
  productId: string,
) {
  const membership = await tx.productFamilyMember.findUnique({
    where: { productId },
    select: {
      familyId: true,
      family: {
        select: {
          primaryProductId: true,
          members: {
            orderBy: [{ position: "asc" }, { productId: "asc" }],
            select: { productId: true },
          },
        },
      },
    },
  });
  return membership
    ? {
        familyId: membership.familyId,
        primaryProductId: membership.family.primaryProductId,
        productIds: membership.family.members.map((member) => member.productId),
      }
    : null;
}

/**
 * Propagates fields that the business treats as family-owned. SKU identity,
 * colours/media, supplier ownership, stock, reservations and cost accounting
 * are intentionally absent from this routine.
 */
export async function propagateProductFamilySharedData(
  tx: Prisma.TransactionClient,
  sourceProductId: string,
  groups: ProductFamilySyncGroup[] = ["master", "commercial"],
) {
  const family = await getProductFamilyProductIds(tx, sourceProductId);
  if (!family || family.productIds.length < 2) return [];
  await lockFamily(tx, family.familyId);
  const source = await tx.product.findUniqueOrThrow({
    where: { id: sourceProductId },
    include: {
      categories: { select: { categoryId: true } },
      materials: { select: { materialId: true } },
      pictograms: { select: { pictogramId: true } },
      assemblyCities: { select: { cityId: true } },
      attachments: true,
      lookupAssignments: {
        where: { lookupValue: { kind: { not: "COLOR" } } },
        select: { lookupValueId: true },
      },
      priceListEntries: true,
      actionPrices: true,
      loyaltyRules: true,
    },
  });
  const targetIds = family.productIds.filter((id) => id !== sourceProductId);
  if (!targetIds.length) return [];
  const targets = await tx.product.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, sku: true, supplierId: true, supplierApprovalStatus: true },
  });

  const syncMaster = groups.includes("master");
  const syncCommercial = groups.includes("commercial");
  for (const target of targets) {
    const data: Prisma.ProductUncheckedUpdateInput = {};
    if (syncMaster) {
      Object.assign(data, {
        name: source.name,
        shortName: source.shortName,
        description: source.description,
        shortDescription: source.shortDescription,
        sizeLabel: source.sizeLabel,
        attribute1: source.attribute1,
        attribute2: source.attribute2,
        attribute3: source.attribute3,
        attribute4: source.attribute4,
        groupId: source.groupId,
        collectionId: source.collectionId,
        widthCm: source.widthCm,
        depthCm: source.depthCm,
        heightCm: source.heightCm,
        weightKg: source.weightKg,
        grossWeightKg: source.grossWeightKg,
        unitPackWidthCm: source.unitPackWidthCm,
        unitPackDepthCm: source.unitPackDepthCm,
        unitPackHeightCm: source.unitPackHeightCm,
        packQty: source.packQty,
        packWidthCm: source.packWidthCm,
        packDepthCm: source.packDepthCm,
        packHeightCm: source.packHeightCm,
        packGrossWeightKg: source.packGrossWeightKg,
        containerQty: source.containerQty,
        containerGrossWeightKg: source.containerGrossWeightKg,
        materialText: source.materialText,
        hsCode: source.hsCode,
        moq: source.moq,
        customsRate: source.customsRate,
        ananasBrokeragePct: source.ananasBrokeragePct,
        ananasStoragePct: source.ananasStoragePct,
        ananasDeliveryPct: source.ananasDeliveryPct,
        pdpDeliveryTerms: source.pdpDeliveryTerms,
        declaration: source.declaration,
        assemblyInstructions: source.assemblyInstructions,
        maintenance: source.maintenance,
        technicalSpecs:
          source.technicalSpecs === null
            ? Prisma.JsonNull
            : (source.technicalSpecs as Prisma.InputJsonValue),
        warrantyYears: source.warrantyYears,
        countryOfOrigin: source.countryOfOrigin,
        deliveryDaysMin: source.deliveryDaysMin,
        deliveryDaysMax: source.deliveryDaysMax,
        allowsAssembly: source.allowsAssembly,
      });
    }
    if (syncCommercial) {
      Object.assign(data, {
        fullPrice: source.fullPrice,
        salePrice: source.salePrice,
        discountPct: source.discountPct,
        loyaltyPrice: source.loyaltyPrice,
        loyaltyDiscountPct: source.loyaltyDiscountPct,
        actionId: source.actionId,
        articleStatus: source.articleStatus,
        isHero: source.isHero,
        isNew: source.isNew,
        newUntil: source.newUntil,
        newUntilAutomatic: source.newUntilAutomatic,
        isLimited: source.isLimited,
        isDtz: source.isDtz,
        availableWebManual: source.availableWebManual,
        availableWholesaleManual: source.availableWholesaleManual,
        availableExportManual: source.availableExportManual,
        inGoogleMerchant: source.inGoogleMerchant,
        inMetaCatalog: source.inMetaCatalog,
        inTiktokCatalog: source.inTiktokCatalog,
        deletedAt: source.deletedAt,
        // Supplier approval remains a hard per-SKU publication gate.
        isActive:
          target.supplierId && target.supplierApprovalStatus !== "APPROVED"
            ? false
            : source.isActive,
      });
    }
    await tx.product.update({ where: { id: target.id }, data });

    if (syncMaster) {
      await replaceSimpleRelations(tx, target.id, source);
      await tx.productAttachment.deleteMany({ where: { productId: target.id } });
      if (source.attachments.length) {
        await tx.productAttachment.createMany({
          data: source.attachments.map((attachment) => ({
            productId: target.id,
            kind: attachment.kind,
            section: attachment.section,
            origin: attachment.origin,
            label:
              attachment.origin === "ADMIN_UPLOAD"
                ? productAttachmentAdminLabel(target.sku, attachment.section)
                : attachment.label,
            url: attachment.url,
            sourceUrl: attachment.sourceUrl,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            syncStatus: attachment.syncStatus,
            order: attachment.order,
          })),
        });
      }
    }
    if (syncCommercial) {
      await replaceCommercialRelations(tx, target.id, source);
    }
  }
  return targetIds;
}

async function replaceSimpleRelations(
  tx: Prisma.TransactionClient,
  productId: string,
  source: {
    categories: Array<{ categoryId: string }>;
    materials: Array<{ materialId: string }>;
    pictograms: Array<{ pictogramId: string }>;
    assemblyCities: Array<{ cityId: string }>;
    lookupAssignments: Array<{ lookupValueId: string }>;
  },
) {
  await tx.productCategory.deleteMany({ where: { productId } });
  if (source.categories.length) {
    await tx.productCategory.createMany({
      data: source.categories.map(({ categoryId }) => ({ productId, categoryId })),
    });
  }
  await tx.productMaterial.deleteMany({ where: { productId } });
  if (source.materials.length) {
    await tx.productMaterial.createMany({
      data: source.materials.map(({ materialId }) => ({ productId, materialId })),
    });
  }
  await tx.productPictogram.deleteMany({ where: { productId } });
  if (source.pictograms.length) {
    await tx.productPictogram.createMany({
      data: source.pictograms.map(({ pictogramId }) => ({ productId, pictogramId })),
    });
  }
  await tx.productAssemblyCity.deleteMany({ where: { productId } });
  if (source.assemblyCities.length) {
    await tx.productAssemblyCity.createMany({
      data: source.assemblyCities.map(({ cityId }) => ({ productId, cityId })),
    });
  }
  const colorAssignments = await tx.productLookupAssignment.findMany({
    where: { productId, lookupValue: { kind: "COLOR" } },
    select: { lookupValueId: true },
  });
  await tx.productLookupAssignment.deleteMany({ where: { productId } });
  const lookupValueIds = [
    ...colorAssignments.map((entry) => entry.lookupValueId),
    ...source.lookupAssignments.map((entry) => entry.lookupValueId),
  ];
  if (lookupValueIds.length) {
    await tx.productLookupAssignment.createMany({
      data: Array.from(new Set(lookupValueIds)).map((lookupValueId) => ({
        productId,
        lookupValueId,
      })),
      skipDuplicates: true,
    });
  }
}

async function replaceCommercialRelations(
  tx: Prisma.TransactionClient,
  productId: string,
  source: {
    priceListEntries: Array<{
      priceListId: string;
      price: Prisma.Decimal;
      validFrom: Date;
      validTo: Date | null;
    }>;
    actionPrices: Array<{ actionId: string; salePrice: Prisma.Decimal }>;
    loyaltyRules: Array<{ loyaltyRuleId: string }>;
  },
) {
  await tx.priceListEntry.deleteMany({ where: { productId } });
  if (source.priceListEntries.length) {
    await tx.priceListEntry.createMany({
      data: source.priceListEntries.map((entry) => ({
        productId,
        priceListId: entry.priceListId,
        price: entry.price,
        validFrom: entry.validFrom,
        validTo: entry.validTo,
      })),
    });
  }
  await tx.actionProduct.deleteMany({ where: { productId } });
  if (source.actionPrices.length) {
    await tx.actionProduct.createMany({
      data: source.actionPrices.map((entry) => ({
        productId,
        actionId: entry.actionId,
        salePrice: entry.salePrice,
      })),
    });
  }
  await tx.loyaltyRuleProduct.deleteMany({ where: { productId } });
  if (source.loyaltyRules.length) {
    await tx.loyaltyRuleProduct.createMany({
      data: source.loyaltyRules.map((entry) => ({
        productId,
        loyaltyRuleId: entry.loyaltyRuleId,
      })),
    });
  }
}
