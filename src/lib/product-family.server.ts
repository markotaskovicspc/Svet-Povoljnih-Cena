import "server-only";

import { Prisma } from "@prisma/client";
import {
  defaultProductFamilyLabel,
  normalizeProductFamilyCode,
  normalizeProductFamilyHex,
  normalizeProductFamilyLabel,
  productFamilyReadinessReasons,
  productFamilyLabelKey,
} from "@/lib/product-family";
import { productAttachmentAdminLabel } from "@/lib/product-documents";
import { activeRetailPriceEntryWhere } from "@/lib/pricing/retail-price-write.server";
import { storefrontPublicationBlockers } from "@/lib/web-storefront-availability";
import { syncArticleLookupAssignments } from "@/lib/admin/article-master.server";

export type ProductFamilySyncGroup = "master" | "publication";

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

  const labelConflict = await tx.productFamilyMember.findFirst({
    where: {
      familyId: family.id,
      labelKey,
      productId: { not: input.productId },
    },
    select: { product: { select: { sku: true } } },
  });
  if (labelConflict) {
    throw new Error(
      `Boja ${label} je već povezana sa SKU-om ${labelConflict.product.sku}.`,
    );
  }

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

async function uniqueProductFamilyCode(
  tx: Prisma.TransactionClient,
  sku: string,
  productId: string,
) {
  const base = normalizeProductFamilyCode(sku);
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const code =
      suffix === 0
        ? base
        : normalizeProductFamilyCode(
            `${base}-${productId.slice(-6)}${suffix === 1 ? "" : `-${suffix}`}`,
          );
    const existing = await tx.productFamily.findUnique({
      where: { code },
      select: { members: { where: { productId }, select: { productId: true } } },
    });
    if (!existing || existing.members.length) return code;
  }
  throw new Error("Nije moguće napraviti jedinstvenu internu šifru porodice.");
}

export async function syncProductFamilyMembershipColor(
  tx: Prisma.TransactionClient,
  input: {
    productId: string;
    colorPrimary?: string | null;
    colorSecondary?: string | null;
  },
) {
  const membership = await tx.productFamilyMember.findUnique({
    where: { productId: input.productId },
    select: {
      family: { select: { code: true } },
      colorHex: true,
      position: true,
      storefrontEnabled: true,
    },
  });
  if (!membership) return null;
  const label = defaultProductFamilyLabel(input);
  if (!label) {
    throw new Error(
      "Artikal u porodici boja mora imati popunjeno polje Boja 1.",
    );
  }
  return setProductFamilyMembership(tx, {
    productId: input.productId,
    familyCode: membership.family.code,
    label,
    colorHex: membership.colorHex,
    position: membership.position,
    storefrontEnabled: membership.storefrontEnabled,
  });
}

export async function ensureProductColorFamily(
  tx: Prisma.TransactionClient,
  productId: string,
) {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      id: true,
      sku: true,
      colorPrimary: true,
      colorSecondary: true,
      familyMembership: {
        select: {
          familyId: true,
          label: true,
          colorHex: true,
          position: true,
          storefrontEnabled: true,
          family: { select: { code: true, primaryProductId: true } },
        },
      },
    },
  });
  const label = defaultProductFamilyLabel(product);
  if (!label) {
    throw new Error(
      `SKU ${product.sku} mora imati popunjeno polje Boja 1 pre povezivanja.`,
    );
  }
  if (product.familyMembership) {
    await setProductFamilyMembership(tx, {
      productId,
      familyCode: product.familyMembership.family.code,
      label,
      colorHex: product.familyMembership.colorHex,
      position: product.familyMembership.position,
      storefrontEnabled: product.familyMembership.storefrontEnabled,
    });
    return {
      familyId: product.familyMembership.familyId,
      familyCode: product.familyMembership.family.code,
      primaryProductId:
        product.familyMembership.family.primaryProductId ?? productId,
    };
  }

  const familyCode = await uniqueProductFamilyCode(tx, product.sku, product.id);
  const member = await setProductFamilyMembership(tx, {
    productId,
    familyCode,
    label,
    position: 0,
    storefrontEnabled: true,
    makePrimary: true,
  });
  if (!member) throw new Error("Porodica boja nije kreirana.");
  return { familyId: member.familyId, familyCode, primaryProductId: productId };
}

export async function addExistingProductToColorFamily(
  tx: Prisma.TransactionClient,
  input: {
    sourceProductId: string;
    targetProductId: string;
    colorPrimary: string;
    colorSecondary?: string | null;
  },
) {
  if (input.sourceProductId === input.targetProductId) {
    throw new Error("Artikal ne može biti povezan sam sa sobom.");
  }
  const target = await tx.product.findUniqueOrThrow({
    where: { id: input.targetProductId },
    select: {
      id: true,
      sku: true,
      deletedAt: true,
      attribute1: true,
      attribute2: true,
      attribute3: true,
      attribute4: true,
      lookupAssignments: {
        where: { lookupValue: { kind: { in: ["BENEFIT", "CERTIFICATE"] } } },
        select: { lookupValue: { select: { kind: true, value: true } } },
      },
      familyMembership: { select: { family: { select: { code: true } } } },
    },
  });
  if (target.deletedAt) throw new Error("Arhivirani artikal ne može biti povezan.");
  if (target.familyMembership) {
    throw new Error(
      `SKU ${target.sku} već pripada porodici ${target.familyMembership.family.code}.`,
    );
  }
  const label = defaultProductFamilyLabel(input);
  if (!label) throw new Error("Boja 1 je obavezna za povezani artikal.");

  const family = await ensureProductColorFamily(tx, input.sourceProductId);
  const lastMember = await tx.productFamilyMember.findFirst({
    where: { familyId: family.familyId },
    orderBy: [{ position: "desc" }, { productId: "desc" }],
    select: { position: true },
  });
  await tx.product.update({
    where: { id: target.id },
    data: {
      colorPrimary: input.colorPrimary.trim(),
      colorSecondary: input.colorSecondary?.trim() || null,
    },
  });
  await syncArticleLookupAssignments(tx, target.id, {
    attributes: [
      target.attribute1,
      target.attribute2,
      target.attribute3,
      target.attribute4,
    ],
    colors: [input.colorPrimary, input.colorSecondary],
    benefits: target.lookupAssignments
      .filter(({ lookupValue }) => lookupValue.kind === "BENEFIT")
      .map(({ lookupValue }) => lookupValue.value),
    certificates: target.lookupAssignments
      .filter(({ lookupValue }) => lookupValue.kind === "CERTIFICATE")
      .map(({ lookupValue }) => lookupValue.value),
  });
  await setProductFamilyMembership(tx, {
    productId: target.id,
    familyCode: family.familyCode,
    label,
    position: (lastMember?.position ?? -1) + 1,
    storefrontEnabled: false,
  });
  await propagateProductFamilySharedData(tx, family.primaryProductId, ["master"]);
  return { familyId: family.familyId, familyCode: family.familyCode, target };
}

export async function moveProductFamilyMember(
  tx: Prisma.TransactionClient,
  productId: string,
  direction: "up" | "down",
) {
  const membership = await tx.productFamilyMember.findUniqueOrThrow({
    where: { productId },
    select: { familyId: true },
  });
  await lockFamily(tx, membership.familyId);
  const members = await tx.productFamilyMember.findMany({
    where: { familyId: membership.familyId },
    orderBy: [{ position: "asc" }, { productId: "asc" }],
    select: { productId: true },
  });
  const index = members.findIndex((member) => member.productId === productId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= members.length) return members;
  [members[index], members[targetIndex]] = [members[targetIndex]!, members[index]!];
  for (const [position, member] of members.entries()) {
    await tx.productFamilyMember.update({
      where: { productId: member.productId },
      data: { position },
    });
  }
  return members;
}

export async function setProductColorFamilyPrimary(
  tx: Prisma.TransactionClient,
  productId: string,
) {
  const membership = await tx.productFamilyMember.findUniqueOrThrow({
    where: { productId },
    select: { familyId: true },
  });
  return normalizeProductFamilyPrimary(tx, membership.familyId, productId);
}

export async function getProductColorFamilyReadiness(
  tx: Pick<Prisma.TransactionClient, "product">,
  productId: string,
  now = new Date(),
) {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      sku: true,
      colorPrimary: true,
      colorSecondary: true,
      isActive: true,
      deletedAt: true,
      availableWebManual: true,
      availableWebAuto: true,
      articleStatus: true,
      stock: true,
      dcAvailableQty: true,
      supplierStock: true,
      supplierApprovalStatus: true,
      lastSupplierStockSyncAt: true,
      supplier: { select: { integrationKey: true, enabled: true } },
      media: {
        where: { kind: "IMAGE", syncStatus: "READY" },
        orderBy: { order: "asc" },
        take: 1,
        select: { id: true },
      },
      priceListEntries: {
        where: activeRetailPriceEntryWhere(now),
        take: 1,
        select: { id: true },
      },
    },
  });
  const publicationBlockers = storefrontPublicationBlockers({
    isActive: product.isActive,
    deletedAt: product.deletedAt,
    availableWebManual: product.availableWebManual,
    availableWebAuto: product.availableWebAuto,
    articleStatus: product.articleStatus,
    stock: product.stock,
    dcAvailableQty: product.dcAvailableQty,
    supplierStock: product.supplierStock,
    supplierApprovalStatus: product.supplierApprovalStatus,
    lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
    supplier: product.supplier,
    hasActiveRetailPrice: product.priceListEntries.length > 0,
    familyStorefrontEnabled: null,
  });
  return {
    sku: product.sku,
    reasons: productFamilyReadinessReasons({
      colorPrimary: product.colorPrimary,
      colorSecondary: product.colorSecondary,
      hasReadyImage: product.media.length > 0,
      publicationBlockers,
    }),
  };
}

export async function setProductColorFamilyStorefrontEnabled(
  tx: Prisma.TransactionClient,
  productId: string,
  enabled: boolean,
) {
  const membership = await tx.productFamilyMember.findUniqueOrThrow({
    where: { productId },
    select: { familyId: true },
  });
  if (enabled) {
    const readiness = await getProductColorFamilyReadiness(tx, productId);
    if (readiness.reasons.length) {
      throw new Error(
        `Boja SKU ${readiness.sku} nije spremna za web: ${readiness.reasons.join("; ")}.`,
      );
    }
  }
  await lockFamily(tx, membership.familyId);
  return tx.productFamilyMember.update({
    where: { productId },
    data: { storefrontEnabled: enabled },
  });
}

export async function detachProductColorFamilyMember(
  tx: Prisma.TransactionClient,
  productId: string,
) {
  return setProductFamilyMembership(tx, { productId, familyCode: null });
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
 * colours/media, supplier ownership, stock, prices, promotions, lifecycle
 * statuses, reservations and cost accounting are intentionally absent.
 */
export async function propagateProductFamilySharedData(
  tx: Prisma.TransactionClient,
  sourceProductId: string,
  groups: ProductFamilySyncGroup[] = ["master", "publication"],
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
    },
  });
  const targetIds = family.productIds.filter((id) => id !== sourceProductId);
  if (!targetIds.length) return [];
  const targets = await tx.product.findMany({
    where: { id: { in: targetIds } },
    select: { id: true, sku: true },
  });

  const syncMaster = groups.includes("master");
  const syncPublication = groups.includes("publication");
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
        palletQty: source.palletQty,
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
    if (syncPublication) {
      Object.assign(data, {
        availableWebManual: source.availableWebManual,
        availableWholesaleManual: source.availableWholesaleManual,
        availableExportManual: source.availableExportManual,
        inGoogleMerchant: source.inGoogleMerchant,
        inMetaCatalog: source.inMetaCatalog,
        inTiktokCatalog: source.inTiktokCatalog,
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
