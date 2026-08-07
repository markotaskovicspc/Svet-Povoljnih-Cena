import "server-only";
import { Prisma } from "@prisma/client";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db, hasDatabaseConnection } from "@/lib/db";
import type {
  Category as CategoryDTO,
  Product as ProductDTO,
  ProductVariantFamily,
} from "@/types";
import { BRAND } from "@/lib/brand";
import { num, numOrNull } from "@/lib/api/_helpers";
import { isRenderableImageUrl } from "@/lib/media";
import { resolveSupabaseStorageMedia } from "@/lib/supabase/storage";
import {
  effectiveSourcePrice,
  parseSourcePrice,
  sourceLongDescription,
  sourceMediaImages,
  sourceProductDisplayName,
  sourceValue,
  svetAkcijaProducts,
  type SvetAkcijaProduct,
} from "@/lib/svet-akcija/catalog";
import {
  resolveRabaluxAvailability,
} from "@/lib/rabalux/availability";
import {
  isRabaluxSupplierOperational,
} from "@/lib/rabalux/config";
import {
  applyActivePricingRules,
  getActivePricingRules,
  type ActivePricingRules,
} from "@/lib/pricing/rules";
import {
  isProductAvailableOnWeb,
  storefrontAvailabilityWhere,
  storefrontInStockWhere,
  webStorefrontProductWhere,
} from "@/lib/web-storefront-availability";
import {
  DEFAULT_DELIVERY_WINDOWS,
  getDeliveryWindows,
  resolveDeliveryWindowForQuantity,
  type DeliveryWindows,
} from "@/lib/delivery-windows";
import { resolveRetailPrice } from "@/lib/pricing/retail-price";
import { productAttachmentAdminLabel } from "@/lib/product-documents";
import {
  productNewUntilFloor,
  productNewUntilIsActive,
} from "@/lib/product-newness";
import {
  heroProductsWhere,
  excludeRabaluxPromotionProductsWhere,
  limitedOfferProductsWhere,
  permanentPriceProductsWhere,
  storefrontMonth,
} from "@/lib/storefront/promotion-filters";
import { buildProductDeclaration } from "@/lib/product-declaration";
import { formatProductAttributes } from "@/lib/product-attributes";
import { rabaluxPictogramPriority } from "@/lib/rabalux/pictograms";
import { formatProductDisplayName } from "@/lib/product-name";
import { isProductColorLabel } from "@/lib/product-colors";
import {
  dynamicFacetsForGroups,
  type Availability,
  type FacetExtents,
  type FacetValues,
} from "@/lib/listing/filters";

/**
 * Catalog read layer (Phase 3C).
 *
 * Catalog read layer for imported products. Conversion sits in `mapProduct`:
 * Prisma `Decimal`s become plain numbers, and M:N relations become flat arrays.
 */

function categoryPathLabels(
  categories: Array<{ category: { name: string } }>,
): string[] {
  const labels = categories.flatMap((c) =>
    c.category.name
      .split(/\s*\/\s*/)
      .map((label) => label.trim())
      .filter(Boolean),
  );
  return labels.filter((label, index) => label !== labels[index - 1]);
}

const slugify = (input: string) =>
  input
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[čć]/g, "c")
    .replace(/[š]/g, "s")
    .replace(/[ž]/g, "z")
    .replace(/[đ]/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);

const productCardCoreSelect = {
  id: true,
  sku: true,
  slug: true,
  name: true,
  sizeLabel: true,
  isActive: true,
  availableWebManual: true,
  availableWebAuto: true,
  articleStatus: true,
  shortDescription: true,
  attribute1: true,
  attribute2: true,
  attribute3: true,
  attribute4: true,
  colorPrimary: true,
  colorSecondary: true,
  widthCm: true,
  depthCm: true,
  heightCm: true,
  stock: true,
  dcAvailableQty: true,
  incomingStock: true,
  supplierStock: true,
  supplierReservedStock: true,
  supplierNextArrivalAt: true,
  supplierApprovalStatus: true,
  lastSupplierStockSyncAt: true,
  packWidthCm: true,
  packDepthCm: true,
  packHeightCm: true,
  unitPackWidthCm: true,
  unitPackDepthCm: true,
  unitPackHeightCm: true,
  warrantyYears: true,
  supplier: { select: { integrationKey: true, enabled: true } },
  isHero: true,
  isNew: true,
  newUntil: true,
  isLimited: true,
  isDtz: true,
  fullPrice: true,
  salePrice: true,
  discountPct: true,
  loyaltyPrice: true,
  loyaltyDiscountPct: true,
  deliveryDaysMin: true,
  deliveryDaysMax: true,
  allowsAssembly: true,
  groupId: true,
  group: true,
  collection: true,
  action: true,
  actionPrices: { include: { action: true } },
  priceListEntries: {
    where: { priceList: { active: true, kind: "RETAIL" } },
    include: { priceList: true },
    orderBy: { validFrom: "desc" },
  },
  categories: { include: { category: true }, orderBy: { category: { level: "asc" } } },
  // Cards expose a compact preview gallery; the PDP still loads every asset.
  media: {
    where: { kind: "IMAGE", syncStatus: "READY" },
    orderBy: { order: "asc" },
    take: 6,
  },
  materials: { include: { material: true } },
} satisfies Prisma.ProductSelect;

type ProductCardCoreRow = Prisma.ProductGetPayload<{
  select: typeof productCardCoreSelect;
}>;

const familyMembershipSelect = {
  label: true,
  colorHex: true,
  position: true,
  storefrontEnabled: true,
  family: {
    select: {
      id: true,
      code: true,
      primaryProductId: true,
      members: {
        orderBy: [{ position: "asc" }, { productId: "asc" }],
        select: {
          productId: true,
          label: true,
          colorHex: true,
          position: true,
          storefrontEnabled: true,
          product: { select: productCardCoreSelect },
        },
      },
    },
  },
} satisfies Prisma.ProductFamilyMemberSelect;

const productListSelect = {
  ...productCardCoreSelect,
  familyMembership: { select: familyMembershipSelect },
} satisfies Prisma.ProductSelect;

type ProductListRow = Prisma.ProductGetPayload<{ select: typeof productListSelect }>;

const productFacetSelect = {
  sku: true,
  group: { select: { slug: true, name: true } },
  colorPrimary: true,
  colorSecondary: true,
  attribute1: true,
  attribute2: true,
  attribute3: true,
  attribute4: true,
  widthCm: true,
  depthCm: true,
  heightCm: true,
  stock: true,
  dcAvailableQty: true,
  incomingStock: true,
  supplierStock: true,
  supplierReservedStock: true,
  supplierApprovalStatus: true,
  lastSupplierStockSyncAt: true,
  supplier: { select: { integrationKey: true, enabled: true } },
  fullPrice: true,
  salePrice: true,
  priceListEntries: {
    where: { priceList: { active: true, kind: "RETAIL" } },
    include: { priceList: true },
    orderBy: { validFrom: "desc" },
  },
  materials: { include: { material: true } },
  familyMembership: { select: { label: true, colorHex: true } },
} satisfies Prisma.ProductSelect;

type ProductFacetRow = Prisma.ProductGetPayload<{
  select: typeof productFacetSelect;
}>;

const productInclude = {
  group: true,
  collection: true,
  action: true,
  supplier: { select: { integrationKey: true, enabled: true } },
  actionPrices: { include: { action: true } },
  priceListEntries: {
    where: { priceList: { active: true, kind: "RETAIL" } },
    include: { priceList: true },
    orderBy: { validFrom: "desc" },
  },
  categories: { include: { category: true }, orderBy: { category: { level: "asc" } } },
  media: { where: { syncStatus: "READY" }, orderBy: { order: "asc" } },
  pictograms: {
    include: { pictogram: true },
    orderBy: { pictogram: { label: "asc" } },
  },
  materials: { include: { material: true } },
  assemblyCities: { include: { city: true } },
  attachments: {
    where: { syncStatus: "READY" },
    orderBy: [{ section: "asc" }, { order: "asc" }],
  },
  familyMembership: { select: familyMembershipSelect },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function mapImageMedia(m: {
  url: string;
  thumbUrl?: string | null;
  cardUrl?: string | null;
  pdpUrl?: string | null;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  blurDataUrl?: string | null;
}) {
  const media = resolveSupabaseStorageMedia(m);
  return {
    url: media.url,
    thumbUrl: media.thumbUrl || undefined,
    cardUrl: media.cardUrl || undefined,
    pdpUrl: media.pdpUrl || undefined,
    alt: m.alt ?? undefined,
    width: m.width ?? undefined,
    height: m.height ?? undefined,
    blurDataUrl: m.blurDataUrl ?? undefined,
  };
}

function mapProduct(
  p: ProductRow,
  pricingRules?: ActivePricingRules,
  deliveryWindows: DeliveryWindows = DEFAULT_DELIVERY_WINDOWS,
): ProductDTO {
  const availability = productStockAvailability(p);
  const isRabalux = p.supplier?.integrationKey === "RABALUX";
  const pictograms = p.pictograms
    .map((pp) => ({
      id: pp.pictogram.id,
      code: pp.pictogram.code,
      label: pp.pictogram.label,
      iconUrl: pp.pictogram.iconUrl,
    }))
    .sort((left, right) =>
      isRabalux
        ? rabaluxPictogramPriority(left.code) -
          rabaluxPictogramPriority(right.code)
        : left.label.localeCompare(right.label, "sr-Latn"),
    );
  const retailPrice = resolveRetailPrice(p.priceListEntries, p.fullPrice);
  const sortedCats = [...p.categories].sort(
    (a, b) => (a.category?.level ?? 0) - (b.category?.level ?? 0),
  );
  const product: ProductDTO = {
    id: p.id,
    supplierIntegrationKey: p.supplier?.integrationKey ?? undefined,
    sku: p.sku,
    slug: p.slug,
    name: formatProductDisplayName(p.name, p.sizeLabel),
    group: p.group?.slug ?? "",
    groupId: p.groupId ?? undefined,
    collection: p.collection?.slug,
    categoryPath: categoryPathLabels(sortedCats),
    categoryIds: sortedCats.map((item) => item.categoryId),
    pricingCategoryPaths: sortedCats.map((item) => item.category.path),
    description: p.description,
    shortDescription: p.shortDescription ?? undefined,
    sizeLabel: p.sizeLabel ?? undefined,
    dimensionsCm: {
      w: num(p.widthCm) || 0,
      d: num(p.depthCm) || 0,
      h: num(p.heightCm) || 0,
    },
    packageDimensionsCm: packageDimensions(p),
    colorPrimary: p.colorPrimary ?? undefined,
    colorSecondary: p.colorSecondary ?? undefined,
    attributes: formatProductAttributes([
      p.attribute1,
      p.attribute2,
      p.attribute3,
      p.attribute4,
    ]),
    materials: p.materials.map((m) => ({
      id: m.material.id,
      label: m.material.label,
      imageUrl: m.material.imageUrl ?? undefined,
    })),
    pictograms,
    stock: availability.sellableStock,
    incomingStock: p.incomingStock,
    supplierNextArrivalAt: p.supplierNextArrivalAt?.toISOString(),
    availabilitySource: availability.source,
    isHero: p.isHero,
    isNew: isRabalux ? false : productNewUntilIsActive(p.newUntil),
    newUntil: isRabalux ? undefined : p.newUntil?.toISOString(),
    isLimited: isRabalux ? false : p.isLimited,
    isDtz: isRabalux ? false : p.isDtz,
    fullPrice: retailPrice.price,
    salePrice: numOrNull(p.salePrice) ?? undefined,
    discountPct: p.discountPct ?? undefined,
    loyaltyPrice: numOrNull(p.loyaltyPrice) ?? undefined,
    loyaltyDiscountPct: p.loyaltyDiscountPct ?? undefined,
    action: p.action
      ? {
          id: p.action.id,
          name: p.action.name,
          startsAt: p.action.startsAt.toISOString(),
          endsAt: p.action.endsAt.toISOString(),
          isHero: p.action.isHero,
          isPermanent: p.action.isPermanent,
        }
      : undefined,
    actionPrices: p.actionPrices.map((entry) => ({
      price: num(entry.salePrice),
      priority: entry.action.priority,
      startsAt: entry.action.startsAt.toISOString(),
      endsAt: entry.action.endsAt.toISOString(),
      isPermanent: entry.action.isPermanent,
      actionId: entry.action.id,
      actionName: entry.action.name,
      isHero: entry.action.isHero,
    })),
    pdpInfo: {
      deliveryTerms: p.pdpDeliveryTerms ?? undefined,
      declaration: buildProductDeclaration({
        name: p.name,
        shortName: p.shortName,
        shortDescription: p.shortDescription,
        categoryLabels: categoryPathLabels(sortedCats),
        materialText: p.materialText,
        materialLabels: p.materials.map((item) => item.material.label),
        countryOfOrigin: p.countryOfOrigin,
        manualDeclaration: p.declaration,
      }),
      assemblyInstructions: p.assemblyInstructions ?? undefined,
      maintenance: p.maintenance ?? undefined,
    },
    technicalSpecs: parseTechnicalSpecs(p.technicalSpecs),
    warrantyYears: p.warrantyYears ?? undefined,
    countryOfOrigin: p.countryOfOrigin ?? undefined,
    attachments: p.attachments.map((attachment) => ({
      kind:
        attachment.kind === "MANUAL"
          ? "manual"
          : attachment.kind === "ENERGY_LABEL"
            ? "energy_label"
            : "document",
      section: attachment.section.toLowerCase() as
        | "general"
        | "delivery_terms"
        | "declaration"
        | "assembly_instructions"
        | "maintenance",
      label:
        attachment.origin === "ADMIN_UPLOAD" && attachment.section !== "GENERAL"
          ? productAttachmentAdminLabel(
              p.sku,
              attachment.section,
            )
          : attachment.label,
      url: resolveSupabaseStorageMedia({ url: attachment.url }).url,
      mimeType: attachment.mimeType ?? undefined,
      sizeBytes: attachment.sizeBytes ?? undefined,
    })),
    deliveryDays: resolveDeliveryWindowForQuantity(
      {
        quantity: 1,
        dcAvailable: availability.warehouseAvailable,
        supplierAvailable: availability.supplierAvailable,
      },
      deliveryWindows,
    ),
    allowsAssembly: p.allowsAssembly,
    assemblyCities: p.assemblyCities.map((a) => a.city.name),
    media: {
      images: p.media
        .filter((m) => m.kind === "IMAGE")
        .map(mapImageMedia)
        .filter((m) => isRenderableImageUrl(m.url)),
      video: p.media.find((m) => m.kind === "VIDEO")
        ? {
            url: resolveSupabaseStorageMedia({
              url: p.media.find((m) => m.kind === "VIDEO")!.url,
            }).url,
          }
        : undefined,
      video3d: p.media.find((m) => m.kind === "VIDEO_3D")
        ? { url: p.media.find((m) => m.kind === "VIDEO_3D")!.url }
        : undefined,
    },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  };
  const pricedProduct = pricingRules
    ? applyActivePricingRules(product, pricingRules)
    : product;
  return attachProductVariantFamily(
    pricedProduct,
    p.familyMembership,
    pricingRules,
    deliveryWindows,
  );
}

function sourceDateToIso(value: string) {
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function mapSvetAkcijaFallback(product: SvetAkcijaProduct): ProductDTO {
  const sku = sourceValue(product, "Šifra");
  const sourceName = sourceValue(product, "Kratki naziv") || sku;
  const name = sourceProductDisplayName(product) || sourceName;
  const category = sourceValue(product, "Kategorija");
  const group = sourceValue(product, "Grupa");
  const fullPrice = parseSourcePrice(sourceValue(product, "MPC redovna")) ?? 0;
  const sourcePrice = effectiveSourcePrice(product);
  const salePrice = sourcePrice.salePrice ?? undefined;
  const discountPct =
    salePrice && fullPrice > salePrice
      ? Math.round(((fullPrice - salePrice) / fullPrice) * 100)
      : undefined;
  const description = sourceLongDescription(product);

  return {
    sku,
    slug: slugify(`${sourceName}-${sku}`),
    name,
    group: slugify(group),
    collection: slugify(sourceValue(product, "Kolekcija (brend)")),
    categoryPath: [category, group].filter(Boolean),
    description,
    shortDescription: sourceValue(product, "Opis") || undefined,
    sizeLabel: sourceValue(product, "Veličina") || undefined,
    dimensionsCm: { w: 0, d: 0, h: 0 },
    colorPrimary: sourceValue(product, "Boja 1") || undefined,
    colorSecondary: sourceValue(product, "Boja 2") || undefined,
    attributes: formatProductAttributes([
      sourceValue(product, "Atribut 1"),
      sourceValue(product, "Atribut 2"),
    ]),
    materials: [],
    pictograms: [],
    stock: 0,
    incomingStock: 0,
    availabilitySource: "NONE",
    isHero: false,
    isNew: false,
    isLimited: false,
    isDtz: false,
    fullPrice,
    salePrice,
    discountPct,
    action: salePrice
      ? {
          id: "svet-akcija",
          name: `${BRAND.name} akcija`,
          startsAt: sourceDateToIso(sourceValue(product, "Važenje akcijske cene od")),
          endsAt: sourceDateToIso(sourceValue(product, "Važenje akcijske cene do")),
          isHero: false,
        }
      : undefined,
    deliveryDays: { min: 3, max: 5 },
    allowsAssembly: false,
    assemblyCities: [],
    media: {
      images:
        sourceMediaImages(product)
          .map((image) => {
            const media = resolveSupabaseStorageMedia({
              url: image.url,
              thumbUrl: image.thumbUrl,
              cardUrl: image.cardUrl,
              pdpUrl: image.pdpUrl,
            });
            return {
              url: media.url,
              thumbUrl: media.thumbUrl || undefined,
              cardUrl: media.cardUrl || undefined,
              pdpUrl: media.pdpUrl || undefined,
              alt: image.alt ?? name,
              width: image.width ?? undefined,
              height: image.height ?? undefined,
              blurDataUrl: image.blurDataUrl ?? undefined,
            };
          })
          .filter((image) => isRenderableImageUrl(image.url)) ?? [],
    },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  };
}

function mapProductListItem(
  p: ProductCardCoreRow,
  pricingRules?: ActivePricingRules,
  deliveryWindows: DeliveryWindows = DEFAULT_DELIVERY_WINDOWS,
): ProductDTO {
  const availability = productStockAvailability(p);
  const isRabalux = p.supplier?.integrationKey === "RABALUX";
  const retailPrice = resolveRetailPrice(p.priceListEntries, p.fullPrice);
  const sortedCats = [...p.categories].sort(
    (a, b) => (a.category?.level ?? 0) - (b.category?.level ?? 0),
  );
  const product: ProductDTO = {
    id: p.id,
    supplierIntegrationKey: p.supplier?.integrationKey ?? undefined,
    sku: p.sku,
    slug: p.slug,
    name: formatProductDisplayName(p.name, p.sizeLabel),
    group: p.group?.slug ?? "",
    groupId: p.groupId ?? undefined,
    collection: p.collection?.slug,
    categoryPath: categoryPathLabels(sortedCats),
    categoryIds: sortedCats.map((item) => item.categoryId),
    pricingCategoryPaths: sortedCats.map((item) => item.category.path),
    description: "",
    shortDescription: p.shortDescription ?? undefined,
    sizeLabel: p.sizeLabel ?? undefined,
    dimensionsCm: {
      w: num(p.widthCm) || 0,
      d: num(p.depthCm) || 0,
      h: num(p.heightCm) || 0,
    },
    packageDimensionsCm: packageDimensions(p),
    colorPrimary: p.colorPrimary ?? undefined,
    colorSecondary: p.colorSecondary ?? undefined,
    attributes: formatProductAttributes([
      p.attribute1,
      p.attribute2,
      p.attribute3,
      p.attribute4,
    ]),
    materials: p.materials.map((m) => ({
      id: m.material.id,
      label: m.material.label,
      imageUrl: m.material.imageUrl ?? undefined,
    })),
    pictograms: [],
    stock: availability.sellableStock,
    incomingStock: p.incomingStock,
    supplierNextArrivalAt: p.supplierNextArrivalAt?.toISOString(),
    availabilitySource: availability.source,
    isHero: p.isHero,
    isNew: isRabalux ? false : productNewUntilIsActive(p.newUntil),
    newUntil: isRabalux ? undefined : p.newUntil?.toISOString(),
    isLimited: isRabalux ? false : p.isLimited,
    isDtz: isRabalux ? false : p.isDtz,
    fullPrice: retailPrice.price,
    salePrice: numOrNull(p.salePrice) ?? undefined,
    discountPct: p.discountPct ?? undefined,
    loyaltyPrice: numOrNull(p.loyaltyPrice) ?? undefined,
    loyaltyDiscountPct: p.loyaltyDiscountPct ?? undefined,
    warrantyYears: p.warrantyYears ?? undefined,
    action: p.action
      ? {
          id: p.action.id,
          name: p.action.name,
          startsAt: p.action.startsAt.toISOString(),
          endsAt: p.action.endsAt.toISOString(),
          isHero: p.action.isHero,
          isPermanent: p.action.isPermanent,
        }
      : undefined,
    actionPrices: p.actionPrices.map((entry) => ({
      price: num(entry.salePrice),
      priority: entry.action.priority,
      startsAt: entry.action.startsAt.toISOString(),
      endsAt: entry.action.endsAt.toISOString(),
      isPermanent: entry.action.isPermanent,
      actionId: entry.action.id,
      actionName: entry.action.name,
      isHero: entry.action.isHero,
    })),
    deliveryDays: resolveDeliveryWindowForQuantity(
      {
        quantity: 1,
        dcAvailable: availability.warehouseAvailable,
        supplierAvailable: availability.supplierAvailable,
      },
      deliveryWindows,
    ),
    allowsAssembly: p.allowsAssembly,
    assemblyCities: [],
    media: {
      images: p.media
        .map(mapImageMedia)
        .filter((m) => isRenderableImageUrl(m.url)),
    },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  };
  return pricingRules
    ? applyActivePricingRules(product, pricingRules)
    : product;
}

type FamilyMembershipRow = NonNullable<ProductListRow["familyMembership"]>;

function attachProductVariantFamily(
  product: ProductDTO,
  membership: FamilyMembershipRow | null,
  pricingRules?: ActivePricingRules,
  deliveryWindows: DeliveryWindows = DEFAULT_DELIVERY_WINDOWS,
): ProductDTO {
  if (!membership) return product;

  const options = membership.family.members.flatMap((member) => {
    if (
      !member.storefrontEnabled ||
      !isProductAvailableOnWeb(member.product) ||
      member.product.priceListEntries.length === 0
    ) {
      return [];
    }
    const variant = mapProductListItem(
      member.product,
      pricingRules,
      deliveryWindows,
    );
    return [{
      productId: variant.id,
      sku: variant.sku,
      slug: variant.slug,
      name: variant.name,
      label: member.label,
      colorHex: member.colorHex ?? undefined,
      colorPrimary: variant.colorPrimary,
      colorSecondary: variant.colorSecondary,
      position: member.position,
      isPrimary: member.productId === membership.family.primaryProductId,
      thumbnail: variant.media.images[0],
      media: variant.media,
      fullPrice: variant.fullPrice,
      salePrice: variant.salePrice,
      discountPct: variant.discountPct,
      loyaltyPrice: variant.loyaltyPrice,
      loyaltyDiscountPct: variant.loyaltyDiscountPct,
      stock: variant.stock,
      incomingStock: variant.incomingStock,
      supplierNextArrivalAt: variant.supplierNextArrivalAt,
      availabilitySource: variant.availabilitySource,
      deliveryDays: variant.deliveryDays,
      isHero: variant.isHero,
      isNew: variant.isNew,
      isLimited: variant.isLimited,
      isDtz: variant.isDtz,
      action: variant.action,
      actionPrices: variant.actionPrices,
    }];
  });
  if (!options.length) return product;

  const selected =
    options.find((option) => option.sku === product.sku) ??
    options.find((option) => option.isPrimary) ??
    options[0]!;
  const family: ProductVariantFamily = {
    id: membership.family.id,
    code: membership.family.code,
    primarySku: options.find((option) => option.isPrimary)?.sku,
    selectedSku: selected.sku,
    options,
  };

  if (selected.sku === product.sku) {
    return { ...product, variantFamily: family };
  }
  return {
    ...product,
    id: selected.productId,
    sku: selected.sku,
    slug: selected.slug,
    name: selected.name,
    colorPrimary: selected.colorPrimary,
    colorSecondary: selected.colorSecondary,
    media: selected.media,
    fullPrice: selected.fullPrice,
    salePrice: selected.salePrice,
    discountPct: selected.discountPct,
    loyaltyPrice: selected.loyaltyPrice,
    loyaltyDiscountPct: selected.loyaltyDiscountPct,
    stock: selected.stock,
    incomingStock: selected.incomingStock,
    supplierNextArrivalAt: selected.supplierNextArrivalAt,
    availabilitySource: selected.availabilitySource,
    deliveryDays: selected.deliveryDays,
    isHero: selected.isHero ?? false,
    isNew: selected.isNew ?? false,
    isLimited: selected.isLimited ?? false,
    isDtz: selected.isDtz ?? false,
    action: selected.action,
    actionPrices: selected.actionPrices,
    variantFamily: family,
  };
}

function mapProductListRow(
  row: ProductListRow,
  pricingRules?: ActivePricingRules,
  deliveryWindows: DeliveryWindows = DEFAULT_DELIVERY_WINDOWS,
) {
  return attachProductVariantFamily(
    mapProductListItem(row, pricingRules, deliveryWindows),
    row.familyMembership,
    pricingRules,
    deliveryWindows,
  );
}

function productStockAvailability(product: {
  stock: number;
  dcAvailableQty: number;
  supplierStock: number | null;
  supplierReservedStock: number;
  supplierApprovalStatus: string | null;
  lastSupplierStockSyncAt: Date | null;
  supplier: { integrationKey: string | null; enabled: boolean } | null;
}) {
  if (product.supplier?.integrationKey !== "RABALUX") {
    const stock = Math.max(Math.trunc(product.stock), 0);
    return {
      warehouseAvailable: stock,
      supplierAvailable: 0,
      sellableStock: stock,
      source: stock > 0 ? ("DC" as const) : ("NONE" as const),
    };
  }
  return resolveRabaluxAvailability({
    warehouseStock: product.dcAvailableQty,
    supplierStock: product.supplierStock,
    supplierReservedStock: product.supplierReservedStock,
    lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
    supplierOperational: isRabaluxSupplierOperational(product.supplier),
    supplierApproved: product.supplierApprovalStatus === "APPROVED",
  });
}

function packageDimensions(p: {
  packWidthCm: Prisma.Decimal | null;
  packDepthCm: Prisma.Decimal | null;
  packHeightCm: Prisma.Decimal | null;
  unitPackWidthCm: Prisma.Decimal | null;
  unitPackDepthCm: Prisma.Decimal | null;
  unitPackHeightCm: Prisma.Decimal | null;
  widthCm: Prisma.Decimal | null;
  depthCm: Prisma.Decimal | null;
  heightCm: Prisma.Decimal | null;
}) {
  const dimensions = {
    w: num(p.packWidthCm ?? p.unitPackWidthCm ?? p.widthCm) || 0,
    d: num(p.packDepthCm ?? p.unitPackDepthCm ?? p.depthCm) || 0,
    h: num(p.packHeightCm ?? p.unitPackHeightCm ?? p.heightCm) || 0,
  };
  return Object.values(dimensions).some((value) => value > 0)
    ? dimensions
    : undefined;
}

function parseTechnicalSpecs(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) return undefined;
  const specs = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (
      typeof record.key !== "string" ||
      typeof record.label !== "string" ||
      typeof record.value !== "string"
    ) {
      return [];
    }
    return [{ key: record.key, label: record.label, value: record.value }];
  });
  return specs.length ? specs : undefined;
}

function getSvetAkcijaFallbackBySlug(slug: string): ProductDTO | null {
  if (!allowStaticCatalogFallback()) return null;
  const decoded = decodeURIComponent(slug);
  const product = svetAkcijaProducts.find((item) => {
    const sku = sourceValue(item, "Šifra");
    const name = sourceValue(item, "Kratki naziv") || sku;
    return slugify(`${name}-${sku}`) === decoded;
  });
  return product ? mapSvetAkcijaFallback(product) : null;
}

function allowStaticCatalogFallback() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_STATIC_CATALOG_FALLBACK === "1"
  );
}

// ── Categories ────────────────────────────────────────────────────────

export interface CategoryNode extends CategoryDTO {
  children: CategoryNode[];
}

async function loadCategoryTree(): Promise<CategoryNode[]> {
  if (!hasDatabaseConnection()) return [];
  try {
    const rows = await db.category.findMany({
      orderBy: [{ level: "asc" }, { order: "asc" }],
    });
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
  } catch (error) {
    console.error("[catalog] Failed to load category tree.", error);
    return [];
  }
}

const getCategoryTreeAcrossRequests = unstable_cache(
  loadCategoryTree,
  ["storefront-category-tree-v1"],
  { revalidate: 60, tags: ["storefront-categories"] },
);

export const getCategoryTree = cache(getCategoryTreeAcrossRequests);

export async function getCategoryBySlug(slug: string) {
  if (!hasDatabaseConnection()) return null;
  return db.category.findUnique({ where: { slug } });
}

export async function getCategoryByPath(path: string) {
  if (!hasDatabaseConnection()) return null;
  return db.category.findUnique({ where: { path } });
}

export async function getCollectionBySlug(
  slug: string,
): Promise<{ slug: string; name: string } | null> {
  if (!hasDatabaseConnection()) return null;
  return db.collection.findUnique({
    where: { slug },
    select: { slug: true, name: true },
  });
}

// ── Products ──────────────────────────────────────────────────────────

export type ProductSort = "default" | "price-asc" | "price-desc" | "discount-desc";

export interface ListProductsInput {
  /** Filter by category materialized path prefix, e.g. `/namestaj/police`. */
  categoryPath?: string;
  /** Filter by promo action slug (akcija / nedeljna-akcija / heroji-meseca / outlet…). */
  actionSlug?: string;
  /** Restrict to products assigned to a permanent protected-price action. */
  permanentOnly?: boolean;
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
  groupSlug?: string;
  /** Additional user-selected groups (OR within this facet). */
  groupSlugs?: string[];
  collectionSlug?: string;
  /** Case-insensitive category-label fragment used by listing sub-tabs. */
  categoryKeyword?: string;
  excludeSku?: string;
  /** Restrict to products at or below this effective price. */
  maxPrice?: number;
  priceRange?: [number, number];
  /** Width/depth/height ranges, all in cm. */
  widthRange?: [number, number];
  depthRange?: [number, number];
  heightRange?: [number, number];
  materialIds?: string[];
  materialLabels?: string[];
  colors?: string[];
  attributes?: string[];
  availability?: Availability[];
  dynamicFilters?: Record<string, string[]>;
  inStockOnly?: boolean;
  sort?: ProductSort;
  /** Page size (default 24, max 300). */
  limit?: number;
  /** Cursor = product id; results returned strictly after this id. */
  cursor?: string;
  /** Internal optimization for rails that do not display a result total. */
  includeTotal?: boolean;
}

export interface ListProductsResult {
  items: ProductDTO[];
  nextCursor: string | null;
  total: number;
}

export interface ListProductFacetsResult {
  facets: FacetValues;
  extents: FacetExtents;
}

function liveActionWhere(now: Date): Prisma.ActionWhereInput {
  return {
    OR: [
      { isPermanent: true },
      { startsAt: { lte: now }, endsAt: { gte: now } },
    ],
  };
}

function liveDiscountActionWhere(now: Date): Prisma.ActionWhereInput {
  return {
    isPermanent: false,
    startsAt: { lte: now },
    endsAt: { gte: now },
  };
}

function liveSaleWhere(now: Date): Prisma.ProductWhereInput {
  return {
    OR: [
      {
        salePrice: { not: null },
        OR: [
          { actionId: null },
          { action: { is: liveDiscountActionWhere(now) } },
        ],
      },
      {
        actionPrices: {
          some: { action: { is: liveDiscountActionWhere(now) } },
        },
      },
    ],
  };
}

function appendAnd(where: Prisma.ProductWhereInput, condition: Prisma.ProductWhereInput) {
  const current = where.AND;
  where.AND = [
    ...(Array.isArray(current) ? current : current ? [current] : []),
    condition,
  ];
}

function webStorefrontVisibleProductWhere(): Prisma.ProductWhereInput {
  return {
    AND: [
      webStorefrontProductWhere(),
      {
        OR: [
          { familyMembership: { is: null } },
          { familyMembership: { is: { storefrontEnabled: true } } },
        ],
      },
    ],
  };
}

function dynamicFilterWhere(
  key: string,
  values: string[],
): Prisma.ProductWhereInput | null {
  const widthConditions: Prisma.ProductWhereInput[] = [];

  if (key === "sirina-lezista") {
    for (const value of values) {
      if (value === "180 cm") widthConditions.push({ widthCm: { gte: 180 } });
      if (value === "160 cm") widthConditions.push({ widthCm: { gte: 160, lt: 180 } });
      if (value === "140 cm") widthConditions.push({ widthCm: { gte: 140, lt: 160 } });
      if (value === "≤ 120 cm") {
        widthConditions.push({ OR: [{ widthCm: { lt: 140 } }, { widthCm: null }] });
      }
    }
  } else if (key === "tip") {
    if (values.includes("Ugaona")) widthConditions.push({ widthCm: { gte: 260 } });
    if (values.includes("Ravna")) {
      widthConditions.push({ OR: [{ widthCm: { lt: 260 } }, { widthCm: null }] });
    }
  } else if (key === "broj-vrata") {
    for (const value of values) {
      const count = Number.parseInt(value, 10);
      if (!Number.isFinite(count) || count < 2) continue;
      if (count === 2) {
        widthConditions.push({ OR: [{ widthCm: { lt: 125 } }, { widthCm: null }] });
      } else {
        widthConditions.push({
          widthCm: { gte: count * 50 - 25, lt: count * 50 + 25 },
        });
      }
    }
  }

  return widthConditions.length ? { OR: widthConditions } : null;
}

function buildProductListingWhere(
  input: ListProductsInput,
  now: Date,
  pricingRules: ActivePricingRules,
  monthlyHeroSkus: string[],
) {
  const where: Prisma.ProductWhereInput = webStorefrontProductWhere();

  if (input.categoryPath) {
    appendAnd(where, {
      categories: {
        some: { category: { path: { startsWith: input.categoryPath } } },
      },
    });
  }
  if (input.categoryKeyword) {
    appendAnd(where, {
      categories: {
        some: {
          category: {
            name: { contains: input.categoryKeyword, mode: "insensitive" },
          },
        },
      },
    });
  }
  if (input.actionSlug) {
    appendAnd(where, {
      OR: [
        { action: { is: { slug: input.actionSlug, ...liveActionWhere(now) } } },
        {
          actionPrices: {
            some: {
              action: {
                is: { slug: input.actionSlug, ...liveActionWhere(now) },
              },
            },
          },
        },
      ],
    });
  }
  if (input.permanentOnly) appendAnd(where, permanentPriceProductsWhere());
  if (input.onSaleOnly) {
    const hasGlobalLinearPromotion = pricingRules.linearPromotions.some(
      (promotion) =>
        promotion.categoryIds.length === 0 && promotion.groupIds.length === 0,
    );
    if (!hasGlobalLinearPromotion) {
      const categoryIds = Array.from(
        new Set(
          pricingRules.linearPromotions.flatMap(
            (promotion) => promotion.categoryIds,
          ),
        ),
      );
      const categoryPaths = Array.from(
        new Set(
          pricingRules.linearPromotions.flatMap(
            (promotion) => promotion.categoryPaths,
          ),
        ),
      );
      const groupIds = Array.from(
        new Set(
          pricingRules.linearPromotions.flatMap(
            (promotion) => promotion.groupIds,
          ),
        ),
      );
      appendAnd(where, {
        OR: [
          liveSaleWhere(now),
          ...(categoryIds.length
            ? [{ categories: { some: { categoryId: { in: categoryIds } } } }]
            : []),
          ...(categoryPaths.length
            ? [
                {
                  categories: {
                    some: {
                      category: {
                        OR: categoryPaths.map((path) => ({
                          path: { startsWith: `${path}/` },
                        })),
                      },
                    },
                  },
                },
              ]
            : []),
          ...(groupIds.length ? [{ groupId: { in: groupIds } }] : []),
        ],
      });
    }
  }
  if (input.heroOnly) {
    appendAnd(where, heroProductsWhere(now, monthlyHeroSkus));
  }
  if (input.limitedOnly) {
    appendAnd(where, limitedOfferProductsWhere());
    appendAnd(where, excludeRabaluxPromotionProductsWhere());
  }
  if (input.newOnly) {
    appendAnd(where, { newUntil: { gte: productNewUntilFloor(now) } });
    appendAnd(where, excludeRabaluxPromotionProductsWhere());
  }
  if (input.outletOnly) {
    appendAnd(where, { discountPct: { gte: 30 }, ...liveSaleWhere(now) });
  }
  if (input.groupSlug) appendAnd(where, { group: { is: { slug: input.groupSlug } } });
  if (input.groupSlugs?.length) {
    appendAnd(where, { group: { is: { slug: { in: input.groupSlugs } } } });
  }
  if (input.collectionSlug) {
    appendAnd(where, { collection: { is: { slug: input.collectionSlug } } });
  }
  if (input.excludeSku) appendAnd(where, { sku: { not: input.excludeSku } });
  if (input.inStockOnly) appendAnd(where, storefrontInStockWhere(now));

  const effectivePriceWhere = (range: [number, number]): Prisma.ProductWhereInput => ({
    OR: [
      { salePrice: { gte: range[0], lte: range[1] } },
      {
        AND: [
          { salePrice: null },
          { fullPrice: { gte: range[0], lte: range[1] } },
        ],
      },
    ],
  });
  if (input.maxPrice != null) {
    appendAnd(where, effectivePriceWhere([0, input.maxPrice]));
  }
  if (input.priceRange) appendAnd(where, effectivePriceWhere(input.priceRange));
  if (input.widthRange) {
    appendAnd(where, { widthCm: { gte: input.widthRange[0], lte: input.widthRange[1] } });
  }
  if (input.depthRange) {
    appendAnd(where, { depthCm: { gte: input.depthRange[0], lte: input.depthRange[1] } });
  }
  if (input.heightRange) {
    appendAnd(where, { heightCm: { gte: input.heightRange[0], lte: input.heightRange[1] } });
  }
  if (input.materialIds?.length) {
    appendAnd(where, { materials: { some: { materialId: { in: input.materialIds } } } });
  }
  if (input.materialLabels?.length) {
    appendAnd(where, {
      materials: {
        some: {
          material: {
            is: { label: { in: input.materialLabels, mode: "insensitive" } },
          },
        },
      },
    });
  }
  if (input.colors?.length) {
    const colors = { in: input.colors, mode: "insensitive" as const };
    appendAnd(where, {
      OR: [
        { colorPrimary: colors },
        { colorSecondary: colors },
        {
          familyMembership: {
            is: { label: colors, colorHex: { not: null } },
          },
        },
      ],
    });
  }
  if (input.attributes?.length) {
    const attributes = { in: input.attributes, mode: "insensitive" as const };
    appendAnd(where, {
      OR: [
        { attribute1: attributes },
        { attribute2: attributes },
        { attribute3: attributes },
        { attribute4: attributes },
      ],
    });
  }
  if (input.availability?.length) {
    appendAnd(where, storefrontAvailabilityWhere(input.availability, now));
  }
  for (const [key, values] of Object.entries(input.dynamicFilters ?? {})) {
    const condition = dynamicFilterWhere(key, values);
    if (condition) appendAnd(where, condition);
  }

  // Every published colour SKU occupies its own listing row and contributes
  // independently to totals and cursor pagination. The family remains attached
  // only so each card can offer the colour thumbnail selector.
  appendAnd(where, {
    OR: [
      { familyMembership: { is: null } },
      { familyMembership: { is: { storefrontEnabled: true } } },
    ],
  });
  return where;
}

async function loadProducts(
  input: ListProductsInput = {},
): Promise<ListProductsResult> {
  if (!hasDatabaseConnection()) {
    return { items: [], nextCursor: null, total: 0 };
  }

  const now = new Date();
  const heroPeriod = input.heroOnly ? storefrontMonth(now) : null;
  const [pricingRules, deliveryWindows, monthlyHeroes] = await Promise.all([
    getActivePricingRules(),
    getDeliveryWindows(),
    heroPeriod
      ? db.heroOfMonth.findMany({
          where: heroPeriod,
          orderBy: { order: "asc" },
          select: { productSku: true },
        })
      : Promise.resolve([]),
  ]);
  const listingWhere = buildProductListingWhere(
    input,
    now,
    pricingRules,
    monthlyHeroes.map((hero) => hero.productSku),
  );
  const orderBy: Prisma.ProductOrderByWithRelationInput[] = (() => {
    switch (input.sort) {
      case "price-asc":
        return [{ salePrice: "asc" }, { fullPrice: "asc" }];
      case "price-desc":
        return [{ salePrice: "desc" }, { fullPrice: "desc" }];
      case "discount-desc":
        return [{ discountPct: "desc" }, { fullPrice: "asc" }];
      default:
        if (input.newOnly) return [{ newUntil: "desc" }];
        return [{ isHero: "desc" }, { discountPct: "desc" }, { fullPrice: "asc" }];
    }
  })();
  orderBy.push({ id: "asc" });

  const limit = Math.min(Math.max(input.limit ?? 24, 1), 300);

  const rowsQuery = db.product.findMany({
    where: listingWhere,
    select: productListSelect,
    orderBy,
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const [rows, total] = await Promise.all([
    rowsQuery,
    input.includeTotal === false
      ? Promise.resolve(0)
      : db.product.count({ where: listingWhere }),
  ]);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: slice.map((product) =>
      mapProductListRow(product, pricingRules, deliveryWindows),
    ),
    nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    total,
  };
}

export async function listProducts(
  input: ListProductsInput = {},
  options: { throwOnError?: boolean } = {},
): Promise<ListProductsResult> {
  try {
    return await loadProducts(input);
  } catch (error) {
    console.error("[catalog] Failed to list products.", error);
    if (options.throwOnError) throw error;
    return { items: [], nextCursor: null, total: 0 };
  }
}

function emptyProductFacets(): ListProductFacetsResult {
  return {
    facets: {
      groups: [],
      groupLabels: {},
      materials: [],
      colors: [],
      colorSwatches: {},
      attributes: [],
      counts: {
        groups: {},
        materials: {},
        colors: {},
        attributes: {},
        availability: { "in-stock": 0, incoming: 0, "out-of-stock": 0 },
      },
      dynamic: {},
    },
    extents: {
      price: [0, 0],
      width: [0, 0],
      depth: [0, 0],
      height: [0, 0],
    },
  };
}

function computeProductFacets(rows: ProductFacetRow[]): ListProductFacetsResult {
  if (!rows.length) return emptyProductFacets();

  const result = emptyProductFacets();
  const { facets } = result;
  const groups = new Set<string>();
  const materials = new Map<string, string>();
  const colors = new Map<string, string>();
  const attributes = new Map<string, string>();
  const dynamic: Record<string, Set<string>> = {};
  const prices: number[] = [];
  const widths: number[] = [];
  const depths: number[] = [];
  const heights: number[] = [];

  const collect = (
    target: Map<string, string>,
    counts: Record<string, number>,
    values: Array<string | null | undefined>,
  ) => {
    const perProduct = new Set<string>();
    for (const raw of values) {
      const value = raw?.trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase("sr-Latn-RS");
      if (perProduct.has(key)) continue;
      perProduct.add(key);
      const canonical = target.get(key) ?? value;
      target.set(key, canonical);
      counts[canonical] = (counts[canonical] ?? 0) + 1;
    }
  };

  const productGroups = Array.from(
    new Set(rows.flatMap((row) => (row.group?.slug ? [row.group.slug] : []))),
  );
  const dynamicFacets = dynamicFacetsForGroups(productGroups);

  for (const row of rows) {
    if (row.group?.slug) {
      groups.add(row.group.slug);
      facets.groupLabels[row.group.slug] = row.group.name;
      facets.counts.groups[row.group.slug] =
        (facets.counts.groups[row.group.slug] ?? 0) + 1;
    }
    collect(
      materials,
      facets.counts.materials,
      row.materials.map((item) => item.material.label),
    );
    collect(
      colors,
      facets.counts.colors,
      [
        row.familyMembership?.colorHex ? row.familyMembership.label : null,
        row.colorPrimary,
        row.colorSecondary,
      ].filter(isProductColorLabel),
    );
    collect(
      attributes,
      facets.counts.attributes,
      formatProductAttributes([
        row.attribute1,
        row.attribute2,
        row.attribute3,
        row.attribute4,
      ]),
    );

    if (row.familyMembership?.label && row.familyMembership.colorHex) {
      const key = row.familyMembership.label.toLocaleLowerCase("sr-Latn-RS");
      const canonical = colors.get(key) ?? row.familyMembership.label;
      facets.colorSwatches[canonical] ??= row.familyMembership.colorHex;
    }

    const availability = productStockAvailability(row);
    const availabilityKey: Availability =
      availability.sellableStock > 0
        ? "in-stock"
        : row.incomingStock > 0
          ? "incoming"
          : "out-of-stock";
    facets.counts.availability[availabilityKey] += 1;

    const dimensions = {
      w: num(row.widthCm) || 0,
      d: num(row.depthCm) || 0,
      h: num(row.heightCm) || 0,
    };
    const retailPrice = resolveRetailPrice(row.priceListEntries, row.fullPrice);
    prices.push(numOrNull(row.salePrice) ?? retailPrice.price);
    widths.push(dimensions.w);
    depths.push(dimensions.d);
    heights.push(dimensions.h);

    for (const facet of dynamicFacets) {
      const value = facet.getValue({ dimensionsCm: dimensions } as ProductDTO);
      if (value) (dynamic[facet.key] ??= new Set()).add(value);
    }
  }

  const localeSort = (left: string, right: string) =>
    left.localeCompare(right, "sr-Latn-RS");
  facets.groups = Array.from(groups).sort((left, right) =>
    (facets.groupLabels[left] ?? left).localeCompare(
      facets.groupLabels[right] ?? right,
      "sr-Latn-RS",
    ),
  );
  facets.materials = Array.from(materials.values()).sort(localeSort);
  facets.colors = Array.from(colors.values()).sort(localeSort);
  facets.attributes = Array.from(attributes.values()).sort(localeSort);
  facets.dynamic = Object.fromEntries(
    Object.entries(dynamic).map(([key, values]) => [
      key,
      Array.from(values).sort(localeSort),
    ]),
  );

  const extent = (
    values: number[],
    step: number,
  ): [number, number] => [
    Math.floor(Math.min(...values) / step) * step,
    Math.ceil(Math.max(...values) / step) * step,
  ];
  result.extents = {
    price: extent(prices, 1000),
    width: extent(widths, 10),
    depth: extent(depths, 10),
    height: extent(heights, 10),
  };
  return result;
}

export async function listProductFacets(
  input: ListProductsInput = {},
): Promise<ListProductFacetsResult> {
  if (!hasDatabaseConnection()) return emptyProductFacets();
  try {
    const now = new Date();
    const heroPeriod = input.heroOnly ? storefrontMonth(now) : null;
    const [pricingRules, monthlyHeroes] = await Promise.all([
      getActivePricingRules(),
      heroPeriod
        ? db.heroOfMonth.findMany({
            where: heroPeriod,
            orderBy: { order: "asc" },
            select: { productSku: true },
          })
        : Promise.resolve([]),
    ]);
    const where = buildProductListingWhere(
      input,
      now,
      pricingRules,
      monthlyHeroes.map((hero) => hero.productSku),
    );
    const rows = await db.product.findMany({ where, select: productFacetSelect });
    return computeProductFacets(rows);
  } catch (error) {
    console.error("[catalog] Failed to list product facets.", error);
    throw error;
  }
}

async function loadProductBySlug(
  slug: string,
): Promise<ProductDTO | null> {
  if (!hasDatabaseConnection()) return getSvetAkcijaFallbackBySlug(slug);
  try {
    const [row, pricingRules, deliveryWindows] = await Promise.all([
      db.product.findFirst({
        where: { slug, ...webStorefrontVisibleProductWhere() },
        include: productInclude,
      }),
      getActivePricingRules(),
      getDeliveryWindows(),
    ]);
    if (!row) return getSvetAkcijaFallbackBySlug(slug);
    return mapProduct(row, pricingRules, deliveryWindows);
  } catch (error) {
    console.error(`[catalog] Failed to load product by slug "${slug}".`, error);
    return getSvetAkcijaFallbackBySlug(slug);
  }
}

const getProductBySlugAcrossRequests = unstable_cache(
  loadProductBySlug,
  ["catalog-product-by-slug-v2-family"],
  {
    revalidate: 30,
    tags: ["catalog-products", "storefront-categories"],
  },
);

// The short shared cache removes repeated full-PDP relation reads while the
// checkout/order API remains authoritative for price and stock at submission.
export const getProductBySlug = cache(getProductBySlugAcrossRequests);

const getCachedProductRail = unstable_cache(
  async (input: ListProductsInput) =>
    listProducts({ ...input, includeTotal: false }),
  ["catalog-product-rail-v3-sku"],
  {
    revalidate: 60,
    tags: ["catalog-products", "storefront-categories"],
  },
);

/** Shared cache for non-authoritative recommendation rails. */
export function listProductRail(
  input: Omit<ListProductsInput, "includeTotal">,
): Promise<ListProductsResult> {
  return getCachedProductRail(input);
}

/**
 * Batch loader for listing cards.
 *
 * Search results already contain the ordered slugs. Loading every card through
 * `getProductBySlug` creates one full product query per hit; this keeps the
 * result order while resolving the page with one listing-shaped query.
 */
export async function getProductCardsBySlugs(
  slugs: readonly string[],
  options: { throwOnError?: boolean } = {},
): Promise<ProductDTO[]> {
  const orderedSlugs = Array.from(
    new Set(slugs.map((slug) => slug.trim()).filter(Boolean)),
  ).slice(0, 120);
  if (!orderedSlugs.length) return [];
  if (!hasDatabaseConnection()) {
    return orderedSlugs
      .map(getSvetAkcijaFallbackBySlug)
      .filter((product): product is ProductDTO => Boolean(product));
  }

  try {
    const [rows, pricingRules, deliveryWindows] = await Promise.all([
      db.product.findMany({
        where: { slug: { in: orderedSlugs }, ...webStorefrontVisibleProductWhere() },
        select: productListSelect,
      }),
      getActivePricingRules(),
      getDeliveryWindows(),
    ]);
    const productsBySlug = new Map(
      rows.map((row) => [
        row.slug,
        mapProductListRow(row, pricingRules, deliveryWindows),
      ]),
    );
    return orderedSlugs
      .map((slug) => productsBySlug.get(slug))
      .filter((product): product is ProductDTO => Boolean(product));
  } catch (error) {
    console.error("[catalog] Failed to batch-load product cards.", error);
    if (options.throwOnError) throw error;
    return [];
  }
}

/** Batch loader for CMS landing-page product blocks, preserving SKU order. */
export async function getProductsBySkus(
  skus: readonly string[],
): Promise<ProductDTO[]> {
  const orderedSkus = Array.from(
    new Set(skus.map((sku) => sku.trim()).filter(Boolean)),
  ).slice(0, 120);
  if (!orderedSkus.length || !hasDatabaseConnection()) return [];

  try {
    const [rows, pricingRules, deliveryWindows] = await Promise.all([
      db.product.findMany({
        where: { sku: { in: orderedSkus }, ...webStorefrontVisibleProductWhere() },
        select: productListSelect,
      }),
      getActivePricingRules(),
      getDeliveryWindows(),
    ]);
    const productsBySku = new Map(
      rows.map((row) => [
        row.sku,
        mapProductListRow(row, pricingRules, deliveryWindows),
      ]),
    );
    return orderedSkus
      .map((sku) => productsBySku.get(sku))
      .filter((product): product is ProductDTO => Boolean(product));
  } catch (error) {
    console.error("[catalog] Failed to batch-load landing-page products.", error);
    return [];
  }
}

export async function getProductBySku(sku: string): Promise<ProductDTO | null> {
  if (!hasDatabaseConnection()) return null;
  const [row, pricingRules, deliveryWindows] = await Promise.all([
    db.product.findFirst({
      where: { sku, ...webStorefrontVisibleProductWhere() },
      include: productInclude,
    }),
    getActivePricingRules(),
    getDeliveryWindows(),
  ]);
  if (!row) return null;
  return mapProduct(row, pricingRules, deliveryWindows);
}

/** "Često kupovano zajedno" — items in the same `collection`. */
export async function getFrequentlyBought(productId: string, limit = 6) {
  const p = await db.product.findUnique({
    where: { id: productId },
    select: { collectionId: true },
  });
  if (!p?.collectionId) return [];
  const [rows, pricingRules, deliveryWindows] = await Promise.all([
    db.product.findMany({
      where: {
        collectionId: p.collectionId,
        id: { not: productId },
        ...webStorefrontVisibleProductWhere(),
      },
      include: productInclude,
      take: Math.min(limit * 4, 100),
      orderBy: [{ isHero: "desc" }, { discountPct: "desc" }],
    }),
    getActivePricingRules(),
    getDeliveryWindows(),
  ]);
  return rows
    .map((product) => mapProduct(product, pricingRules, deliveryWindows))
    .slice(0, limit);
}

/** "Slični artikli" — items in the same `group`. */
export async function getRelatedProducts(productId: string, limit = 8) {
  const p = await db.product.findUnique({
    where: { id: productId },
    select: { groupId: true },
  });
  if (!p?.groupId) return [];
  const [rows, pricingRules, deliveryWindows] = await Promise.all([
    db.product.findMany({
      where: {
        groupId: p.groupId,
        id: { not: productId },
        ...webStorefrontVisibleProductWhere(),
      },
      include: productInclude,
      take: Math.min(limit * 4, 120),
      orderBy: [{ isHero: "desc" }, { discountPct: "desc" }],
    }),
    getActivePricingRules(),
    getDeliveryWindows(),
  ]);
  return rows
    .map((product) => mapProduct(product, pricingRules, deliveryWindows))
    .slice(0, limit);
}

/** Cross-sell list backing the post-add-to-cart "Predlog kupovine" modal. */
export async function getRecommendationsForGroup(groupSlug: string, limit = 6) {
  const [rule, pricingRules, deliveryWindows] = await Promise.all([
    db.recommendationRule.findFirst({
      where: { enabled: true, group: { slug: groupSlug } },
      include: { products: { include: productInclude } },
      orderBy: { order: "asc" },
    }),
    getActivePricingRules(),
    getDeliveryWindows(),
  ]);
  if (!rule) return [];
  return rule.products
    .filter((product) => isProductAvailableOnWeb(product))
    .map((product) => mapProduct(product, pricingRules, deliveryWindows))
    .slice(0, limit);
}

export async function getCartRecommendationsForSkus(
  skus: string[],
  limit = 6,
): Promise<ProductDTO[]> {
  if (!hasDatabaseConnection()) return [];
  const uniqueSkus = Array.from(new Set(skus.map((sku) => sku.trim()).filter(Boolean)));
  if (!uniqueSkus.length) return [];

  const cartProducts = await db.product.findMany({
    where: { sku: { in: uniqueSkus }, ...webStorefrontVisibleProductWhere() },
    select: { groupId: true },
  });
  const groupIds = Array.from(
    new Set(cartProducts.map((product) => product.groupId).filter((id): id is string => Boolean(id))),
  );
  if (!groupIds.length) return [];

  const [rules, pricingRules, deliveryWindows] = await Promise.all([
    db.recommendationRule.findMany({
      where: { enabled: true, groupId: { in: groupIds } },
      include: { products: { include: productInclude } },
      orderBy: [{ order: "asc" }],
    }),
    getActivePricingRules(),
    getDeliveryWindows(),
  ]);

  const seenSkus = new Set(uniqueSkus);
  const out: ProductDTO[] = [];
  for (const rule of rules) {
    for (const product of rule.products) {
      if (
        seenSkus.has(product.sku) ||
        !isProductAvailableOnWeb(product)
      ) {
        continue;
      }
      const mapped = mapProduct(product, pricingRules, deliveryWindows);
      seenSkus.add(product.sku);
      out.push(mapped);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
