import "server-only";

import { Prisma } from "@prisma/client";

export const articleCopySelect = {
  name: true,
  shortName: true,
  description: true,
  shortDescription: true,
  sizeLabel: true,
  colorPrimary: true,
  colorSecondary: true,
  articleStatus: true,
  attribute1: true,
  attribute2: true,
  attribute3: true,
  attribute4: true,
  groupId: true,
  collectionId: true,
  widthCm: true,
  depthCm: true,
  heightCm: true,
  weightKg: true,
  grossWeightKg: true,
  unitPackWidthCm: true,
  unitPackDepthCm: true,
  unitPackHeightCm: true,
  packQty: true,
  packWidthCm: true,
  packDepthCm: true,
  packHeightCm: true,
  packGrossWeightKg: true,
  containerQty: true,
  containerGrossWeightKg: true,
  supplierProductName: true,
  materialText: true,
  hsCode: true,
  moq: true,
  ananasBrokeragePct: true,
  ananasStoragePct: true,
  ananasDeliveryPct: true,
  fullPrice: true,
  pdpDeliveryTerms: true,
  declaration: true,
  assemblyInstructions: true,
  maintenance: true,
  technicalSpecs: true,
  warrantyYears: true,
  countryOfOrigin: true,
  customsRate: true,
  availableWebManual: true,
  availableWholesaleManual: true,
  availableExportManual: true,
  deliveryDaysMin: true,
  deliveryDaysMax: true,
  allowsAssembly: true,
  supplierId: true,
  categories: { select: { categoryId: true } },
  materials: { select: { materialId: true } },
  pictograms: { select: { pictogramId: true } },
  assemblyCities: { select: { cityId: true } },
  lookupAssignments: { select: { lookupValueId: true } },
} satisfies Prisma.ProductSelect;

export type ArticleCopySource = Prisma.ProductGetPayload<{
  select: typeof articleCopySelect;
}>;

export function buildCopiedArticleData(
  source: ArticleCopySource,
  identity: { sku: string; slug: string },
): Prisma.ProductUncheckedCreateInput {
  const technicalSpecs =
    source.technicalSpecs === null
      ? undefined
      : (structuredClone(source.technicalSpecs) as Prisma.InputJsonValue);

  return {
    ...identity,
    name: source.name,
    shortName: source.shortName,
    description: source.description,
    shortDescription: source.shortDescription,
    sizeLabel: source.sizeLabel,
    colorPrimary: source.colorPrimary,
    colorSecondary: source.colorSecondary,
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
    supplierProductName: source.supplierProductName,
    materialText: source.materialText,
    hsCode: source.hsCode,
    moq: source.moq,
    ananasBrokeragePct: source.ananasBrokeragePct,
    ananasStoragePct: source.ananasStoragePct,
    ananasDeliveryPct: source.ananasDeliveryPct,
    fullPrice: source.fullPrice,
    pdpDeliveryTerms: source.pdpDeliveryTerms,
    declaration: source.declaration,
    assemblyInstructions: source.assemblyInstructions,
    maintenance: source.maintenance,
    technicalSpecs,
    warrantyYears: source.warrantyYears,
    countryOfOrigin: source.countryOfOrigin,
    customsRate: source.customsRate,
    availableWebManual: source.availableWebManual,
    availableWholesaleManual: source.availableWholesaleManual,
    availableExportManual: source.availableExportManual,
    deliveryDaysMin: source.deliveryDaysMin,
    deliveryDaysMax: source.deliveryDaysMax,
    allowsAssembly: source.allowsAssembly,
    supplierId: source.supplierId,

    // A copy is always a safe, unpublished draft with no identity, campaign,
    // stock, supplier-feed ownership or advertising state from the source.
    barcode: null,
    articleStatus: "UZ",
    salePrice: null,
    discountPct: null,
    loyaltyPrice: null,
    loyaltyDiscountPct: null,
    actionId: null,
    tncFrom: null,
    tncUntil: null,
    isHero: false,
    isNew: false,
    newUntil: null,
    isLimited: false,
    isDtz: false,
    stock: 0,
    incomingStock: 0,
    supplierStock: null,
    supplierReservedStock: 0,
    supplierNextArrivalAt: null,
    cogs: null,
    dcAvailableQty: 0,
    availableWebAuto: false,
    availableWholesaleAuto: false,
    availableExportAuto: false,
    supplierExternalId: null,
    syncOverrides: undefined,
    supplierApprovalStatus: null,
    supplierApprovedAt: null,
    supplierApprovedById: null,
    supplierCatalogMissingCount: 0,
    supplierCatalogMissingSince: null,
    supplierStockMissingCount: 0,
    supplierStockMissingSince: null,
    lastSupplierSyncAt: null,
    lastSupplierStockSyncAt: null,
    lastSupplierSourceHash: null,
    inGoogleMerchant: false,
    inMetaCatalog: false,
    inTiktokCatalog: false,
    isActive: false,
    deletedAt: null,
  };
}

export async function copyArticleRelations(
  tx: Prisma.TransactionClient,
  productId: string,
  source: ArticleCopySource,
) {
  if (source.categories.length) {
    await tx.productCategory.createMany({
      data: source.categories.map(({ categoryId }) => ({ productId, categoryId })),
      skipDuplicates: true,
    });
  }
  if (source.materials.length) {
    await tx.productMaterial.createMany({
      data: source.materials.map(({ materialId }) => ({ productId, materialId })),
      skipDuplicates: true,
    });
  }
  if (source.pictograms.length) {
    await tx.productPictogram.createMany({
      data: source.pictograms.map(({ pictogramId }) => ({ productId, pictogramId })),
      skipDuplicates: true,
    });
  }
  if (source.assemblyCities.length) {
    await tx.productAssemblyCity.createMany({
      data: source.assemblyCities.map(({ cityId }) => ({ productId, cityId })),
      skipDuplicates: true,
    });
  }
  if (source.lookupAssignments.length) {
    await tx.productLookupAssignment.createMany({
      data: source.lookupAssignments.map(({ lookupValueId }) => ({
        productId,
        lookupValueId,
      })),
      skipDuplicates: true,
    });
  }
}
