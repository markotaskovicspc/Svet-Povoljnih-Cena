import { notFound } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { randomBytes } from "node:crypto";
import { Fragment } from "react";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { num } from "@/lib/api/_helpers";
import { setDefaultWarehouseStock } from "@/lib/inventory";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getManagedProductMediaStorageKeys,
  getProductMediaBucket,
  resolveSupabaseStorageUrl,
} from "@/lib/supabase/storage";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/admin/submit-button";
import { AdminActionForm } from "@/components/admin/action-form";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { ProductCategorySelector } from "@/components/admin/product-category-selector";
import { ProductNewnessField } from "@/components/admin/product-newness-field";
import {
  ProductAttachmentsEditor,
  type EditableProductAttachment,
} from "@/components/admin/product-attachments-editor";
import {
  assertArticleSkuAvailable,
  composedArticleName,
  resolveNamedArticleRelation,
  syncArticleLookupAssignments,
} from "@/lib/admin/article-master.server";
import { articleSlug, optionalDateInput, dateInputValue } from "@/lib/article-master";
import { normalizeArticleSku } from "@/lib/article-sku";
import { ARTICLE_STATUS_OPTIONS } from "@/lib/article-status";
import { sanitizeRichText } from "@/lib/rich-text";
import {
  normalizeFullProductDescription,
  normalizeShortProductDescription,
} from "@/lib/product-descriptions";
import {
  PRODUCT_ATTACHMENT_SECTION_OPTIONS,
  productAttachmentAdminLabel,
} from "@/lib/product-documents";
import {
  retryFailedRabaluxProductMedia,
  syncRabaluxCatalogProduct,
} from "@/lib/rabalux";
import {
  mergeOverrideFields,
  parseOverrideFields,
  RABALUX_OVERRIDE_OPTIONS,
  type RabaluxOverrideGroup,
} from "@/lib/rabalux/ownership";
import { lockSupplierOwnedFields } from "@/lib/rabalux/ownership.server";
import { resolveRetailPrice } from "@/lib/pricing/retail-price";
import {
  getDeliveryWindows,
  resolveDeliveryWindowForQuantity,
} from "@/lib/delivery-windows";
import { formatRsd } from "@/lib/format";
import {
  RABALUX_PUBLIC_STOCK_THRESHOLD,
  RABALUX_SUPPLIER_STOCK_STATUS_LABELS,
  resolveRabaluxAvailability,
  resolveRabaluxSupplierStock,
} from "@/lib/rabalux/availability";
import { isRabaluxSupplierOperational } from "@/lib/rabalux/config";
import {
  defaultProductNewUntil,
  productNewUntilIsActive,
  productNewnessDateInput,
} from "@/lib/product-newness";
import { ensureCategoryGroup } from "@/lib/category-groups.server";
import {
  articleCategorySelectionFromLeaf,
  resolveArticleCategorySelection,
} from "@/lib/admin/article-category-hierarchy";
import {
  propagateProductFamilySharedData,
  setProductFamilyMembership,
} from "@/lib/product-family.server";
import { defaultProductFamilyLabel } from "@/lib/product-family";
import { isProductColorLabel } from "@/lib/product-colors";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Proizvod",
  robots: { index: false, follow: false },
};

const overrideSchema = z.object({
  id: z.string(),
  operationId: z.string().min(16),
  sku: z.string().min(1).max(80),
  name: z.string().min(1).max(200),
  articleStatus: z.enum(["SP", "IT", "DTZ", "DOB", "ARH", "UZ"]),
  supplierId: z.string().optional().nullable(),
  siteCategoryId: z.string().optional().nullable(),
  siteGroupId: z.string().optional().nullable(),
  siteSubgroupId: z.string().optional().nullable(),
  collectionId: z.string().optional().nullable(),
  newCollectionName: z.string().max(120).optional().nullable(),
  barcode: z.string().max(80).optional().nullable(),
  sizeLabel: z.string().max(80).optional().nullable(),
  colorPrimary: z.string().max(120).optional().nullable().refine(
    (value) => !value?.trim() || isProductColorLabel(value),
    "Dimenziju upišite u polje za dimenziju, ne u boju.",
  ),
  colorSecondary: z.string().max(120).optional().nullable().refine(
    (value) => !value?.trim() || isProductColorLabel(value),
    "Dimenziju upišite u polje za dimenziju, ne u boju.",
  ),
  attribute1: z.string().max(120).optional().nullable(),
  attribute2: z.string().max(120).optional().nullable(),
  attribute3: z.string().max(120).optional().nullable(),
  attribute4: z.string().max(120).optional().nullable(),
  benefits: z.string().max(2000).optional().nullable(),
  certificates: z.string().max(2000).optional().nullable(),
  shortDescription: z.string().max(500).optional().nullable(),
  description: z.string().max(20000),
  pdpDeliveryTerms: z.string().max(10000).optional().nullable(),
  declaration: z.string().max(10000).optional().nullable(),
  assemblyInstructions: z.string().max(10000).optional().nullable(),
  maintenance: z.string().max(10000).optional().nullable(),
  stock: z.coerce.number().int().min(0),
  stockAdjustmentReason: z.string().trim().max(500),
  widthCm: z.coerce.number().positive().max(10000),
  depthCm: z.coerce.number().positive().max(10000),
  heightCm: z.coerce.number().positive().max(10000),
  weightKg: optionalNonnegativeNumber(),
  grossWeightKg: optionalNonnegativeNumber(),
  unitPackWidthCm: optionalNonnegativeNumber(),
  unitPackDepthCm: optionalNonnegativeNumber(),
  unitPackHeightCm: optionalNonnegativeNumber(),
  packQty: optionalNonnegativeInteger(),
  packWidthCm: optionalNonnegativeNumber(),
  packDepthCm: optionalNonnegativeNumber(),
  packHeightCm: optionalNonnegativeNumber(),
  packGrossWeightKg: optionalNonnegativeNumber(),
  containerQty: optionalPositiveInteger(),
  containerGrossWeightKg: optionalPositiveNumber(),
  customsRate: optionalNonnegativeNumber(),
  supplierProductName: z.string().max(500).optional().nullable(),
  materialText: z.string().max(5000).optional().nullable(),
  countryOfOrigin: z.string().max(120).optional().nullable(),
  hsCode: z.string().max(80).optional().nullable(),
  moq: optionalNonnegativeInteger(),
  ananasBrokeragePct: optionalNonnegativeNumber(),
  ananasStoragePct: optionalNonnegativeNumber(),
  ananasDeliveryPct: optionalNonnegativeNumber(),
  newUntil: z.string().max(10).optional().nullable(),
  newUntilAutomatic: z.coerce.boolean().default(false),
  allowsAssembly: z.coerce.boolean().default(false),
  availableWebManual: z.coerce.boolean().default(false),
  availableWholesaleManual: z.coerce.boolean().default(false),
  availableExportManual: z.coerce.boolean().default(false),
  familyCode: z.string().max(64).optional().nullable(),
  familyColorLabel: z.string().max(120).optional().nullable(),
  familyColorHex: z.string().max(7).optional().nullable(),
  familyPosition: z.coerce.number().int().min(0).max(10000).default(0),
  familyPrimary: z.coerce.boolean().default(false),
  familyStorefrontEnabled: z.coerce.boolean().default(false),
}).superRefine((value, context) => {
  if (value.familyCode?.trim() && !value.familyColorLabel?.trim()) {
    context.addIssue({
      code: "custom",
      path: ["familyColorLabel"],
      message: "Naziv boje je obavezan kada je artikal u porodici.",
    });
  }
});

const pictogramAssignmentSchema = z.object({
  productId: z.string().min(1),
});

function optionalNonnegativeNumber() {
  return z
    .union([
      z.coerce.number().nonnegative(),
      z.literal("").transform(() => null),
    ])
    .nullable()
    .optional();
}

function optionalPositiveNumber() {
  return z.union([
    z.coerce.number().positive(),
    z.literal("").transform(() => null),
  ]).optional().nullable();
}

function optionalPositiveInteger() {
  return z.union([
    z.coerce.number().int().positive(),
    z.literal("").transform(() => null),
  ]).optional().nullable();
}

function optionalNonnegativeInteger() {
  return z
    .union([
      z.coerce.number().int().nonnegative(),
      z.literal("").transform(() => null),
    ])
    .nullable()
    .optional();
}

function isAllowedMediaReference(value: string) {
  if (value.startsWith("/") || /^https?:\/\//.test(value)) return true;
  if (!value || value.startsWith(".") || value.includes("\\")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  return value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

const MEDIA_REFERENCE_ERROR =
  "URL mora biti puna adresa, putanja koja počinje sa / ili bezbedan storage ključ.";

const mediaSchema = z.object({
  productId: z.string(),
  url: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable()
    .refine(
      (value) => !value || isAllowedMediaReference(value),
      MEDIA_REFERENCE_ERROR,
    ),
  thumbUrl: optionalMediaUrlSchema(),
  cardUrl: optionalMediaUrlSchema(),
  pdpUrl: optionalMediaUrlSchema(),
  alt: z.string().max(200).optional().nullable(),
});

const mediaUpdateSchema = z.object({
  productId: z.string(),
  mediaId: z.string(),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine(
      isAllowedMediaReference,
      MEDIA_REFERENCE_ERROR,
    ),
  thumbUrl: optionalMediaUrlSchema(),
  cardUrl: optionalMediaUrlSchema(),
  pdpUrl: optionalMediaUrlSchema(),
  alt: z.string().max(200).optional().nullable(),
  order: z.coerce.number().int().min(0).max(999),
});

function optionalMediaUrlSchema() {
  return z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable()
    .refine(
      (value) => !value || isAllowedMediaReference(value),
      MEDIA_REFERENCE_ERROR,
    );
}

const mediaDeleteSchema = z.object({
  productId: z.string(),
  mediaId: z.string(),
});

const XML_OVERRIDE_OPTIONS = RABALUX_OVERRIDE_OPTIONS;
type XmlOverrideValue = RabaluxOverrideGroup;
const XML_OVERRIDE_VALUES = new Set<RabaluxOverrideGroup>(
  XML_OVERRIDE_OPTIONS.map((option) => option.value),
);

const COMMON_PRODUCT_SURFACES = [
  "/",
  "/akcija",
  "/pretraga",
  "/novo",
  "/outlet",
  "/ogranicena-ponuda",
  "/sve-do-999",
  "/heroji-meseca",
  "/nedeljna-akcija",
  "/niske-cene-pod-zastitom",
  "/specijalne-ponude",
];

async function revalidateProductSurfaces(productId: string, slug?: string | null) {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: {
      slug: true,
      categories: { select: { category: { select: { path: true } } } },
      familyMembership: {
        select: {
          family: {
            select: {
              members: {
                select: {
                  productId: true,
                  product: { select: { slug: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const productSlug = slug ?? product?.slug;
  revalidatePath("/admin/erp/artikli");
  revalidatePath(`/admin/erp/artikli/${productId}`);
  if (productSlug) revalidatePath(`/p/${productSlug}`);
  for (const member of product?.familyMembership?.family.members ?? []) {
    revalidatePath(`/admin/erp/artikli/${member.productId}`);
    revalidatePath(`/p/${member.product.slug}`);
  }
  for (const path of COMMON_PRODUCT_SURFACES) revalidatePath(path);
  for (const relation of product?.categories ?? []) {
    const categoryPath = relation.category.path.replace(/^\/+/, "");
    if (categoryPath) revalidatePath(`/k/${categoryPath}`);
  }
  updateTag("catalog-products");
}

async function uploadProductImage(productId: string, file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error("Upload podržava samo slike.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("Fotografija ne sme biti veća od 8 MB.");
  }
  const extension =
    file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() ??
    file.type.split("/")[1] ??
    "jpg";
  const key = `products/${productId}/${Date.now()}-${randomBytes(8).toString("hex")}.${extension}`;
  const storage = createAdminClient().storage.from(getProductMediaBucket());
  const { error } = await storage.upload(key, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return key;
}

function changedManualGroups(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const groups: Array<[RabaluxOverrideGroup, string[]]> = [
    ["name", ["name"]],
    ["identity", ["sku", "barcode"]],
    ["description", ["description", "shortDescription"]],
    ["grouping", ["groupId", "collectionId"]],
    ["specifications", ["colorPrimary", "colorSecondary", "countryOfOrigin"]],
    [
      "dimensions",
      [
        "widthCm",
        "depthCm",
        "heightCm",
        "unitPackWidthCm",
        "unitPackDepthCm",
        "unitPackHeightCm",
        "containerQty",
        "containerGrossWeightKg",
      ],
    ],
    ["delivery", ["allowsAssembly"]],
    [
      "flags",
      [
        "articleStatus",
        "isActive",
        "isNew",
        "newUntil",
        "newUntilAutomatic",
        "isDtz",
      ],
    ],
  ];
  return groups
    .filter(([, keys]) =>
      keys.some(
        (key) => JSON.stringify(normalizeComparable(before[key])) !== JSON.stringify(normalizeComparable(after[key])),
      ),
    )
    .map(([group]) => group);
}

function normalizeComparable(value: unknown) {
  if (value instanceof Prisma.Decimal) return Number(value);
  return value ?? null;
}

async function updateProduct(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.update", entity: "Product" },
    async (actorId, formData: FormData) => {
        const raw = Object.fromEntries(formData);
        const bool = (k: string) =>
          formData.get(k) === "on" || formData.get(k) === "true";
        const parsed = overrideSchema.safeParse({
          ...raw,
          allowsAssembly: bool("allowsAssembly"),
          availableWebManual: bool("availableWebManual"),
          availableWholesaleManual: bool("availableWholesaleManual"),
          availableExportManual: bool("availableExportManual"),
          newUntilAutomatic: bool("newUntilAutomatic"),
          familyPrimary: bool("familyPrimary"),
          familyStorefrontEnabled: bool("familyStorefrontEnabled"),
        });
        if (!parsed.success) {
          return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        }
        const d = parsed.data;
        const sku = normalizeArticleSku(d.sku);
        const requestedNewUntil = optionalDateInput(d.newUntil);
        const statusFlags =
          d.articleStatus === "DTZ"
            ? { isActive: true, isDtz: true, isLimited: false }
            : d.articleStatus === "IT"
              ? { isActive: true, isDtz: false, isLimited: true }
              : d.articleStatus === "ARH" || d.articleStatus === "UZ"
                ? { isActive: false, isDtz: false, isLimited: false }
                : { isActive: true, isDtz: false, isLimited: false };
        const data = {
          sku,
          shortName: d.name.trim(),
          barcode: d.barcode?.trim() || null,
          sizeLabel: d.sizeLabel?.trim() || null,
          colorPrimary: d.colorPrimary?.trim() || null,
          colorSecondary: d.colorSecondary?.trim() || null,
          attribute1: d.attribute1?.trim() || null,
          attribute2: d.attribute2?.trim() || null,
          attribute3: d.attribute3?.trim() || null,
          attribute4: d.attribute4?.trim() || null,
          shortDescription: normalizeShortProductDescription(d.shortDescription),
          description: normalizeFullProductDescription(d.description),
          articleStatus: d.articleStatus,
          supplierId: d.supplierId?.trim() || null,
          pdpDeliveryTerms: d.pdpDeliveryTerms?.trim() || null,
          declaration: d.declaration?.trim() || null,
          assemblyInstructions: d.assemblyInstructions?.trim() || null,
          maintenance: d.maintenance?.trim() || null,
          widthCm: d.widthCm,
          depthCm: d.depthCm,
          heightCm: d.heightCm,
          weightKg: d.weightKg ?? null,
          grossWeightKg: d.grossWeightKg ?? null,
          unitPackWidthCm: d.unitPackWidthCm ?? null,
          unitPackDepthCm: d.unitPackDepthCm ?? null,
          unitPackHeightCm: d.unitPackHeightCm ?? null,
          packQty: d.packQty ?? null,
          packWidthCm: d.packWidthCm ?? null,
          packDepthCm: d.packDepthCm ?? null,
          packHeightCm: d.packHeightCm ?? null,
          packGrossWeightKg: d.packGrossWeightKg ?? null,
          containerQty: d.containerQty ?? null,
          containerGrossWeightKg: d.containerGrossWeightKg ?? null,
          customsRate: d.customsRate ?? null,
          supplierProductName: d.supplierProductName?.trim() || null,
          materialText: d.materialText?.trim() || null,
          countryOfOrigin: d.countryOfOrigin?.trim() || null,
          hsCode: d.hsCode?.trim() || null,
          moq: d.moq ?? null,
          ananasBrokeragePct: d.ananasBrokeragePct ?? null,
          ananasStoragePct: d.ananasStoragePct ?? null,
          ananasDeliveryPct: d.ananasDeliveryPct ?? null,
          allowsAssembly: d.allowsAssembly,
          ...statusFlags,
          availableWebManual: d.availableWebManual,
          availableWholesaleManual: d.availableWholesaleManual,
          availableExportManual: d.availableExportManual,
        };
        const updated = await db.$transaction(async (tx) => {
          const existing = await tx.product.findUniqueOrThrow({
            where: { id: d.id },
            select: {
              sku: true,
              articleStatus: true,
              supplierId: true,
              supplierExternalId: true,
              supplierApprovalStatus: true,
              syncOverrides: true,
              name: true,
              barcode: true,
              description: true,
              shortDescription: true,
              colorPrimary: true,
              colorSecondary: true,
              countryOfOrigin: true,
              widthCm: true,
              depthCm: true,
              heightCm: true,
              unitPackWidthCm: true,
              unitPackDepthCm: true,
              unitPackHeightCm: true,
              allowsAssembly: true,
              isActive: true,
              isNew: true,
              newUntil: true,
              newUntilAutomatic: true,
              firstPublishedAt: true,
              isDtz: true,
              groupId: true,
              collectionId: true,
              group: { select: { id: true, name: true } },
              collection: { select: { id: true, name: true } },
              categories: { select: { categoryId: true } },
            },
          });
          // An interactive Prisma transaction owns one PostgreSQL connection;
          // submitting concurrent queries to that connection can stall the pg
          // adapter. Keep transaction-bound queries deliberately sequential.
          if (existing.sku !== sku) {
            await assertArticleSkuAvailable(tx, sku, d.id);
          }
          const categoryRows = await tx.category.findMany({
            select: {
              id: true,
              name: true,
              slug: true,
              parentId: true,
              order: true,
            },
          });
          let categorySelection;
          try {
            categorySelection = resolveArticleCategorySelection(categoryRows, {
              siteCategoryId: d.siteCategoryId ?? "",
              siteGroupId: d.siteGroupId ?? "",
              siteSubgroupId: d.siteSubgroupId ?? "",
            });
          } catch (error) {
            return {
              validationError:
                error instanceof Error
                  ? error.message
                  : "Izabrana pozicija u navigaciji nije ispravna.",
            };
          }
          const requestedCategoryIds = categorySelection.leafCategoryId
            ? [categorySelection.leafCategoryId]
            : [];
          const currentCategoryIds = existing.categories
            .map(({ categoryId }) => categoryId)
            .sort();
          const categoryChanged =
            currentCategoryIds.length !== requestedCategoryIds.length ||
            currentCategoryIds.some(
              (categoryId, index) => categoryId !== requestedCategoryIds[index],
            );
          const requestedCollectionId = d.collectionId?.trim() || null;
          const selectedCategory = categorySelection.leafCategoryId
            ? categoryRows.find(
                (category) => category.id === categorySelection.leafCategoryId,
              ) ?? null
            : null;
          const group = categoryChanged
            ? selectedCategory
              ? await ensureCategoryGroup(tx, selectedCategory)
              : null
            : existing.group;
          const collection =
            !d.newCollectionName &&
            existing.collection?.id === requestedCollectionId
              ? existing.collection
              : await resolveNamedArticleRelation(tx, "collection", {
                  id: requestedCollectionId,
                  name: d.newCollectionName,
                });
          const effectiveNewUntil = d.newUntilAutomatic
            ? existing.firstPublishedAt
              ? defaultProductNewUntil(existing.firstPublishedAt)
              : null
            : requestedNewUntil;
          const completeData = {
            ...data,
            newUntil: effectiveNewUntil,
            newUntilAutomatic: d.newUntilAutomatic,
            isNew: productNewUntilIsActive(effectiveNewUntil),
            name: composedArticleName({
              collectionName: collection?.name,
              shortDescription: d.shortDescription,
              shortName: d.name,
            }),
            groupId: group?.id ?? null,
            collectionId: collection?.id ?? null,
          };
          const manualGroups = existing.supplierId || completeData.supplierId
            ? changedManualGroups(existing, completeData)
            : [];
          const saved = await tx.product.update({
            where: { id: d.id },
            data: {
              ...completeData,
              ...(existing.supplierId &&
              existing.supplierExternalId &&
              existing.supplierApprovalStatus !== "APPROVED"
                ? { isActive: false }
                : {}),
              ...(manualGroups.length
                ? {
                    syncOverrides: mergeOverrideFields(
                      existing.syncOverrides,
                      manualGroups,
                      actorId,
                    ),
                  }
                : {}),
            },
            select: { slug: true },
          });
          if (existing.sku !== sku) {
            for (const section of PRODUCT_ATTACHMENT_SECTION_OPTIONS) {
              await tx.productAttachment.updateMany({
                where: {
                  productId: d.id,
                  section: section.value,
                  origin: "ADMIN_UPLOAD",
                },
                data: {
                  label: productAttachmentAdminLabel(sku, section.value),
                },
              });
            }
          }
          if (categoryChanged) {
            await tx.productCategory.deleteMany({ where: { productId: d.id } });
            if (categorySelection.leafCategoryId) {
              await tx.productCategory.create({
                data: {
                  productId: d.id,
                  categoryId: categorySelection.leafCategoryId,
                },
              });
              await tx.product.updateMany({
                where: {
                  id: d.id,
                  supplierId: { not: null },
                  supplierApprovalStatus: "PENDING_MAPPING",
                },
                data: {
                  supplierApprovalStatus: "PENDING_APPROVAL",
                  isActive: false,
                },
              });
            }
            await lockSupplierOwnedFields(tx, d.id, actorId, ["categories"]);
          }
          await syncArticleLookupAssignments(tx, d.id, {
            attributes: [d.attribute1, d.attribute2, d.attribute3, d.attribute4],
            colors: [d.colorPrimary, d.colorSecondary],
            benefits: d.benefits ?? "",
            certificates: d.certificates ?? "",
          });
          await setProductFamilyMembership(tx, {
            productId: d.id,
            familyCode: d.familyCode,
            label:
              d.familyColorLabel ||
              defaultProductFamilyLabel({
                colorPrimary: d.colorPrimary,
                colorSecondary: d.colorSecondary,
              }),
            colorHex: d.familyColorHex,
            position: d.familyPosition,
            storefrontEnabled: d.familyStorefrontEnabled,
            makePrimary: d.familyPrimary,
          });
          await propagateProductFamilySharedData(tx, d.id);
          await setDefaultWarehouseStock(tx, {
            idempotencyKey: `product-edit:${d.operationId}:stock`,
            productId: d.id,
            targetQty: d.stock,
            actorId,
            note: d.stockAdjustmentReason,
          });
          return { saved };
        });
        if ("validationError" in updated) {
          return { ok: false as const, error: updated.validationError };
        }
        await revalidateProductSurfaces(d.id, updated.saved.slug);
        return {
          ok: true as const,
          entityId: d.id,
          diff: {
            ...data,
            family: {
              code: d.familyCode || null,
              label: d.familyColorLabel || null,
              colorHex: d.familyColorHex || null,
              position: d.familyPosition,
              primary: d.familyPrimary,
              storefrontEnabled: d.familyStorefrontEnabled,
            },
          },
          message: "Proizvod je sačuvan.",
        };
      },
  )(formData);
}

async function updateProductPictograms(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.pictograms.update", entity: "Product" },
    async (actorId, formData: FormData) => {
      const parsed = pictogramAssignmentSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const pictogramIds = Array.from(
        new Set(
          formData
            .getAll("pictogramIds")
            .map((value) => String(value).trim())
            .filter(Boolean),
        ),
      );
      if (pictogramIds.length > 6) {
        return { ok: false as const, error: "Proizvod može da ima najviše 6 piktograma." };
      }

      const [product, pictogramCount] = await Promise.all([
        db.product.findUnique({
          where: { id: parsed.data.productId },
          select: { id: true },
        }),
        pictogramIds.length
          ? db.pictogram.count({ where: { id: { in: pictogramIds } } })
          : Promise.resolve(0),
      ]);
      if (!product) return { ok: false as const, error: "Proizvod više ne postoji." };
      if (pictogramCount !== pictogramIds.length) {
        return { ok: false as const, error: "Jedan od izabranih piktograma više ne postoji." };
      }

      await db.$transaction(async (tx) => {
        await tx.productPictogram.deleteMany({
          where: { productId: parsed.data.productId },
        });
        if (pictogramIds.length) {
          await tx.productPictogram.createMany({
            data: pictogramIds.map((pictogramId) => ({
              productId: parsed.data.productId,
              pictogramId,
            })),
          });
        }
        await lockSupplierOwnedFields(
          tx,
          parsed.data.productId,
          actorId,
          ["pictograms"],
        );
        await propagateProductFamilySharedData(tx, parsed.data.productId, ["master"]);
      });
      await revalidateProductSurfaces(parsed.data.productId);
      return {
        ok: true as const,
        entityId: parsed.data.productId,
        diff: { pictogramIds },
        message: pictogramIds.length
          ? "Piktogrami proizvoda su sačuvani."
          : "Svi piktogrami su uklonjeni sa proizvoda.",
      };
    },
  )(formData);
}

async function addProductImage(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.media.create", entity: "ProductMedia" },
    async (actorId, formData: FormData) => {
      const parsed = mediaSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, alt, thumbUrl, cardUrl, pdpUrl } = parsed.data;
      const files = formData
        .getAll("files")
        .filter((value): value is File => value instanceof File && value.size > 0);
      if (files.length > 10) {
        return { ok: false as const, error: "Možete dodati najviše 10 fotografija odjednom." };
      }
      const remoteUrl = parsed.data.url?.trim() || "";
      if (!files.length && !remoteUrl) {
        return { ok: false as const, error: "Dodajte URL ili upload fotografiju." };
      }

      const uploadedKeys: string[] = [];
      try {
        for (const file of files) {
          uploadedKeys.push(await uploadProductImage(productId, file));
        }
      } catch (err) {
        if (uploadedKeys.length) {
          await createAdminClient().storage.from(getProductMediaBucket()).remove(uploadedKeys);
        }
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : "Upload fotografija nije uspeo.",
        };
      }

      const mediaRows = uploadedKeys.length
        ? uploadedKeys.map((url) => ({ url, thumbUrl: null, cardUrl: null, pdpUrl: null }))
        : [{
            url: remoteUrl,
            thumbUrl: thumbUrl?.trim() || null,
            cardUrl: cardUrl?.trim() || null,
            pdpUrl: pdpUrl?.trim() || null,
          }];
      const last = await db.productMedia.aggregate({
        where: { productId },
        _max: { order: true },
      });
      try {
        await db.$transaction(async (tx) => {
          await tx.productMedia.createMany({
            data: mediaRows.map((row, index) => ({
              productId,
              ...row,
              alt: alt?.trim() || null,
              order: (last._max.order ?? -1) + 1 + index,
            })),
          });
          await lockSupplierOwnedFields(tx, productId, actorId, ["media"]);
        });
      } catch (error) {
        if (uploadedKeys.length) {
          await createAdminClient().storage.from(getProductMediaBucket()).remove(uploadedKeys);
        }
        throw error;
      }
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: productId,
        diff: { productId, urls: mediaRows.map((row) => row.url) },
        message:
          mediaRows.length === 1
            ? "Fotografija je dodata."
            : `${mediaRows.length} fotografija je dodato.`,
      };
    },
  )(formData);
}

async function updateProductMedia(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.media.update", entity: "ProductMedia" },
    async (actorId, formData: FormData) => {
      const parsed = mediaUpdateSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, mediaId, url, thumbUrl, cardUrl, pdpUrl, alt, order } = parsed.data;
      await db.$transaction(async (tx) => {
        await tx.productMedia.updateMany({
          where: { id: mediaId, productId },
          data: {
            url,
            thumbUrl: thumbUrl?.trim() || null,
            cardUrl: cardUrl?.trim() || null,
            pdpUrl: pdpUrl?.trim() || null,
            alt: alt?.trim() || null,
            order,
          },
        });
        await lockSupplierOwnedFields(tx, productId, actorId, ["media"]);
      });
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: mediaId,
        diff: { productId, url, thumbUrl, cardUrl, pdpUrl, alt, order },
        message: "Medij je sačuvan.",
      };
    },
  )(formData);
}

async function deleteProductMedia(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.media.delete", entity: "ProductMedia" },
    async (actorId, formData: FormData) => {
      const parsed = mediaDeleteSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, mediaId } = parsed.data;
      const media = await db.productMedia.findFirst({
        where: { id: mediaId, productId },
        select: {
          id: true,
          url: true,
          thumbUrl: true,
          cardUrl: true,
          pdpUrl: true,
        },
      });
      if (!media) {
        return { ok: false as const, error: "Fotografija ne postoji." };
      }
      const storageKeys = getManagedProductMediaStorageKeys(media);
      if (storageKeys.length) {
        const { error } = await createAdminClient()
          .storage
          .from(getProductMediaBucket())
          .remove(storageKeys);
        if (error) {
          return {
            ok: false as const,
            error: `Storage nije obrisan; fotografija je ostala u katalogu. Pokušajte ponovo: ${error.message}`,
          };
        }
      }
      await db.$transaction(async (tx) => {
        await tx.productMedia.delete({ where: { id: media.id } });
        await lockSupplierOwnedFields(tx, productId, actorId, ["media"]);
      });
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: mediaId,
        diff: { productId, storageKeys },
        message: "Fotografija je obrisana.",
      };
    },
  )(formData);
}

async function updateProductSyncOverrides(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.xml-overrides.update", entity: "Product" },
    async (actorId, formData: FormData) => {
      const productId = String(formData.get("productId") ?? "");
      if (!productId) {
        return { ok: false as const, error: "Nedostaje proizvod." };
      }
      const fields = formData
        .getAll("fields")
        .map((value) => String(value))
        .filter((value): value is XmlOverrideValue =>
          XML_OVERRIDE_VALUES.has(value as XmlOverrideValue),
        );
      const uniqueFields = Array.from(new Set(fields));
      const syncOverrides = uniqueFields.length
        ? ({
            fields: uniqueFields,
            updatedAt: new Date().toISOString(),
            updatedBy: actorId,
          } satisfies Prisma.InputJsonObject)
        : null;

      await db.product.update({
        where: { id: productId },
        data: { syncOverrides: syncOverrides ?? Prisma.DbNull },
      });
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: productId,
        diff: { fields: uniqueFields },
        message: "XML zaštita je sačuvana.",
      };
    },
  )(formData);
}

async function syncSingleRabaluxProduct(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "rabalux.product.sync", entity: "Product" },
    async (actorId, formData: FormData) => {
      const productId = String(formData.get("productId") ?? "");
      const reason = String(formData.get("reason") ?? "").trim();
      const phrase = String(formData.get("phrase") ?? "").trim();
      if (reason.length < 5 || reason.length > 500) {
        return { ok: false as const, error: "Razlog mora imati između 5 i 500 znakova." };
      }
      const product = await db.product.findFirst({
        where: {
          id: productId,
          supplier: { integrationKey: "RABALUX" },
        },
        select: { supplierExternalId: true },
      });
      if (!product?.supplierExternalId) {
        return { ok: false as const, error: "Rabalux proizvod nije pronađen." };
      }
      if (phrase !== `SYNC ${product.supplierExternalId}`) {
        return {
          ok: false as const,
          error: `Unesite tačnu potvrdu: SYNC ${product.supplierExternalId}`,
        };
      }
      const result = await syncRabaluxCatalogProduct(product.supplierExternalId, {
        requestedById: actorId,
        reason,
        allowRiskyPrices: true,
      });
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: productId,
        diff: result as unknown as Record<string, unknown>,
        message: "Jedan Rabalux proizvod je sinhronizovan.",
      };
    },
  )(formData);
}

async function retryFailedRabaluxMedia(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    { allowed: ["OPS"], action: "rabalux.product.media.retry", entity: "Product" },
    async (_actorId, formData: FormData) => {
      const productId = String(formData.get("productId") ?? "");
      const reason = String(formData.get("reason") ?? "").trim();
      if (reason.length < 5 || reason.length > 500) {
        return { ok: false as const, error: "Razlog mora imati između 5 i 500 znakova." };
      }
      const result = await retryFailedRabaluxProductMedia(productId);
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: productId,
        diff: { reason, ...result },
        message: result.queued
          ? "Neuspeli medij je ponovo stavljen u red."
          : "Proizvod nema neuspele medije za retry.",
      };
    },
  )(formData);
}

async function createFamilyColor(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    {
      allowed: ["CONTENT", "OPS"],
      action: "product.family.color.create",
      entity: "ProductFamily",
    },
    async (_actorId, actionData: FormData) => {
      const sourceProductId = String(actionData.get("sourceProductId") ?? "");
      const sku = normalizeArticleSku(String(actionData.get("sku") ?? ""));
      const label = String(actionData.get("label") ?? "").trim();
      const colorHex = String(actionData.get("colorHex") ?? "").trim() || null;
      if (!sourceProductId || !sku || !label) {
        return { ok: false as const, error: "SKU i naziv nove boje su obavezni." };
      }
      const created = await db.$transaction(async (tx) => {
        await assertArticleSkuAvailable(tx, sku);
        const source = await tx.product.findUniqueOrThrow({
          where: { id: sourceProductId },
          select: {
            name: true,
            shortName: true,
            description: true,
            shortDescription: true,
            fullPrice: true,
            familyMembership: {
              select: {
                family: {
                  select: {
                    code: true,
                    members: { select: { position: true } },
                  },
                },
              },
            },
          },
        });
        if (!source.familyMembership) {
          throw new Error("Najpre povežite postojeći artikal sa porodicom boja.");
        }
        const product = await tx.product.create({
          data: {
            sku,
            slug: `${articleSlug(`${source.shortName ?? source.name}-${sku}`)}-${randomBytes(3).toString("hex")}`,
            name: source.name,
            shortName: source.shortName,
            description: source.description,
            shortDescription: source.shortDescription,
            fullPrice: source.fullPrice,
            colorPrimary: label,
            articleStatus: "UZ",
            isActive: false,
            availableWebManual: false,
            availableWholesaleManual: false,
            availableExportManual: false,
          },
        });
        const nextPosition = Math.max(
          0,
          ...source.familyMembership.family.members.map((member) => member.position + 1),
        );
        await setProductFamilyMembership(tx, {
          productId: product.id,
          familyCode: source.familyMembership.family.code,
          label,
          colorHex,
          position: nextPosition,
          storefrontEnabled: false,
        });
        await propagateProductFamilySharedData(tx, sourceProductId);
        await tx.product.update({
          where: { id: product.id },
          data: {
            inGoogleMerchant: false,
            inMetaCatalog: false,
            inTiktokCatalog: false,
          },
        });
        return product;
      });
      await revalidateProductSurfaces(sourceProductId);
      return {
        ok: true as const,
        entityId: created.id,
        diff: { sourceProductId, sku, label, colorHex, storefrontEnabled: false },
        message: `Nova boja ${sku} je kreirana i čeka potvrdu spremnosti za web.`,
      };
    },
  )(formData);
}

export default async function ProductDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const { id } = await params;
  const now = new Date();
  const [
    product,
    categories,
    suppliers,
    collections,
    lookupValues,
    pictograms,
    defaultWarehouse,
    loyaltyRule,
    deliveryWindows,
  ] =
    await Promise.all([
      db.product.findUnique({
        where: { id },
        include: {
          categories: { include: { category: true } },
          pictograms: { include: { pictogram: true } },
          media: { orderBy: { order: "asc" } },
          attachments: { orderBy: [{ section: "asc" }, { order: "asc" }] },
          priceListEntries: {
            where: { priceList: { kind: "RETAIL", active: true } },
            include: { priceList: true },
            orderBy: { validFrom: "desc" },
          },
          actionPrices: {
            include: { action: true },
            orderBy: { action: { priority: "desc" } },
          },
          purchaseOrderItems: {
            where: {
              purchaseOrder: {
                status: { notIn: ["RECEIVED", "CANCELLED"] },
                inboundInvoices: {
                  some: { status: { in: ["RECEIVED", "POSTED"] } },
                },
              },
            },
            select: {
              purchaseOrderId: true,
              qty: true,
              receivedQty: true,
            },
          },
          supplier: true,
          group: true,
          collection: true,
          lookupAssignments: { include: { lookupValue: true } },
          warehouseStocks: {
            where: { warehouse: { active: true, isDefault: true } },
            take: 1,
          },
          orderItems: {
            where: {
              warehouseReservedQty: { gt: 0 },
              order: {
                status: {
                  notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"],
                },
              },
            },
            select: {
              warehouseId: true,
              warehouseReservedQty: true,
            },
          },
          familyMembership: {
            include: {
              family: {
                include: {
                  members: {
                    orderBy: [{ position: "asc" }, { productId: "asc" }],
                    include: {
                      product: {
                        select: {
                          id: true,
                          sku: true,
                          slug: true,
                          name: true,
                          stock: true,
                          availableWebManual: true,
                          availableWebAuto: true,
                          media: {
                            where: { kind: "IMAGE", syncStatus: "READY" },
                            orderBy: { order: "asc" },
                            take: 1,
                          },
                          priceListEntries: {
                            where: { priceList: { kind: "RETAIL", active: true } },
                            orderBy: { validFrom: "desc" },
                            take: 1,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      db.category.findMany({
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          slug: true,
          path: true,
          level: true,
          parentId: true,
          order: true,
        },
      }),
      db.supplier.findMany({
        where: { enabled: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, parity: true, deliveryDays: true },
      }),
      db.collection.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.productLookupValue.findMany({
        where: { active: true },
        orderBy: [{ kind: "asc" }, { value: "asc" }],
        select: { kind: true, value: true },
      }),
      db.pictogram.findMany({
        orderBy: [{ label: "asc" }, { code: "asc" }],
        select: { id: true, code: true, label: true, iconUrl: true },
      }),
      db.warehouse.findFirst({
        where: { active: true, isDefault: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      }),
      db.loyaltyRule.findFirst({
        where: {
          active: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          ],
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      }),
      getDeliveryWindows(),
    ]);
  if (!product) notFound();
  const syncOverrideFields = parseOverrideFields(product.syncOverrides);
  const lookupOptions = (kind: "ATTRIBUTE" | "COLOR" | "BENEFIT" | "CERTIFICATE") =>
    lookupValues.filter((row) => row.kind === kind).map((row) => row.value);
  const assignedValues = (kind: "BENEFIT" | "CERTIFICATE") =>
    product.lookupAssignments
      .filter((row) => row.lookupValue.kind === kind)
      .map((row) => row.lookupValue.value)
      .join(", ");
  const defaultWarehouseRow = product.warehouseStocks[0] ?? null;
  const defaultWarehouseReserved = product.orderItems
    .filter(
      (item) =>
        item.warehouseId === defaultWarehouseRow?.warehouseId ||
        item.warehouseId === null,
    )
    .reduce((sum, item) => sum + item.warehouseReservedQty, 0);
  const defaultWarehouseStock = defaultWarehouseRow
    ? defaultWarehouseRow.qty + defaultWarehouseReserved
    : product.stock + defaultWarehouseReserved;
  const retailPrice = resolveRetailPrice(product.priceListEntries, product.fullPrice, now);
  const activeAction = product.actionPrices.find(
    (entry) =>
      !entry.action.isPermanent &&
      entry.action.startsAt <= now &&
      entry.action.endsAt >= now,
  );
  const hasActionPrice = Boolean(activeAction || product.salePrice);
  const loyaltyDiscountPct = loyaltyRule && !hasActionPrice
    ? Number(loyaltyRule.discountPct)
    : null;
  const loyaltyPrice = loyaltyDiscountPct === null
    ? null
    : Math.max(0, retailPrice.price * (1 - loyaltyDiscountPct / 100));
  const incomingStock = product.purchaseOrderItems.reduce(
    (sum, item) => sum + Math.max(item.qty - item.receivedQty, 0),
    0,
  );
  const rabaluxOperational = isRabaluxSupplierOperational(product.supplier);
  const rabaluxSupplierStock =
    product.supplier?.integrationKey === "RABALUX" &&
    product.supplierExternalId
      ? resolveRabaluxSupplierStock({
          supplierStock: product.supplierStock,
          supplierReservedStock: product.supplierReservedStock,
          lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
          supplierOperational: rabaluxOperational,
          supplierApproved: product.supplierApprovalStatus === "APPROVED",
          now,
        })
      : null;
  const availability = resolveRabaluxAvailability({
    warehouseStock: product.dcAvailableQty,
    supplierStock: product.supplierStock,
    supplierReservedStock: product.supplierReservedStock,
    lastSupplierStockSyncAt: product.lastSupplierStockSyncAt,
    supplierOperational: rabaluxOperational,
    supplierApproved: product.supplierApprovalStatus === "APPROVED",
    now,
  });
  const deliveryWindow = resolveDeliveryWindowForQuantity(
    {
      quantity: 1,
      dcAvailable: availability.warehouseAvailable,
      supplierAvailable: availability.supplierAvailable,
    },
    deliveryWindows,
  );
  const editableAttachments: EditableProductAttachment[] = product.attachments
    .filter((attachment) => attachment.section !== "GENERAL")
    .map((attachment) => ({
      id: attachment.id,
      section: attachment.section as EditableProductAttachment["section"],
      label:
        attachment.origin === "ADMIN_UPLOAD"
          ? productAttachmentAdminLabel(
              product.sku,
              attachment.section as EditableProductAttachment["section"],
            )
          : attachment.label,
      url: resolveSupabaseStorageUrl(attachment.url),
      order: attachment.order,
      origin: attachment.origin,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    }));
  const categorySelection = articleCategorySelectionFromLeaf(
    categories,
    product.categories[0]?.categoryId,
  );
  const selectedLeafCategory = product.categories[0]?.category ?? null;
  const categoryGroupMismatch = Boolean(
    product.group &&
      selectedLeafCategory &&
      product.group.slug !== selectedLeafCategory.slug,
  );

  return (
    <>
      <PageHeader
        title={product.name}
        description={`SKU ${product.sku}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { href: "/admin/erp/artikli", label: "Artikli" },
          { label: product.sku },
        ]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardTitle description="Svaka boja ostaje zaseban SKU sa svojim slikama i zalihama.">
              Boje u porodici
            </CardTitle>
            {product.familyMembership ? (
              <div className="mt-4 space-y-2">
                {product.familyMembership.family.members.map((member) => {
                  const image = member.product.media[0];
                  const price = member.product.priceListEntries[0]?.price;
                  const isPrimary =
                    member.productId === product.familyMembership?.family.primaryProductId;
                  return (
                    <div
                      key={member.productId}
                      className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 p-2.5"
                    >
                      <div className="relative size-12 overflow-hidden rounded-md bg-white ring-1 ring-border">
                        {image ? (
                          <Image
                            src={resolveSupabaseStorageUrl(image.thumbUrl ?? image.url)}
                            alt=""
                            fill
                            sizes="48px"
                            className="object-contain p-1"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 text-xs">
                        <p className="truncate font-semibold text-ink-900">
                          {member.label} {isPrimary ? "· glavna" : ""}
                        </p>
                        <p className="truncate text-ink-500">
                          {member.product.sku} · {price ? formatRsd(Number(price)) : "bez MPC"} · stanje {member.product.stock}
                        </p>
                        <p className={member.storefrontEnabled ? "text-success" : "text-warning"}>
                          {member.storefrontEnabled ? "Boja spremna za web" : "Boja nije spremna za web"}
                        </p>
                      </div>
                      <Link
                        href={`/admin/erp/artikli/${member.productId}`}
                        className="rounded-md border border-border px-3 py-2 text-xs font-semibold hover:border-walnut hover:text-walnut"
                      >
                        Uredi
                      </Link>
                    </div>
                  );
                })}
                <AdminActionForm
                  action={createFamilyColor}
                  refreshOnSuccess
                  className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-dashed border-brand-blue/35 bg-brand-blue-50/30 p-4 md:grid-cols-[1fr_1fr_140px_auto]"
                >
                  <input type="hidden" name="sourceProductId" value={product.id} />
                  <Field label="SKU nove boje">
                    <Input name="sku" required placeholder="Nova jedinstvena šifra" />
                  </Field>
                  <Field label="Naziv boje">
                    <Input name="label" required placeholder="npr. Maslinasto zelena" />
                  </Field>
                  <Field label="HEX fallback">
                    <Input name="colorHex" placeholder="#6B7456" pattern="#[0-9A-Fa-f]{6}" />
                  </Field>
                  <SubmitButton className="self-end">Nova boja</SubmitButton>
                </AdminActionForm>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-500">
                Artikal još nije povezan sa drugim bojama. Unesite eksplicitnu šifru porodice u kartonu ispod.
              </p>
            )}
          </Card>
          <Card>
          <CardTitle description="Opisni podaci se pri čuvanju primenjuju na sve članove porodice. SKU, boje, slike, zalihe, nabavne i prodajne cene, akcije, TNC/DTZ/Novo/Heroji oznake i supplier identitet ostaju samo na konkretnom artiklu.">
            Karton proizvoda
          </CardTitle>
          <AdminActionForm
            action={updateProduct}
            className="space-y-4 pb-24"
            refreshOnSuccess
          >
            <Fragment key={product.updatedAt.toISOString()}>
            <input type="hidden" name="id" value={product.id} />
            <input
              type="hidden"
              name="operationId"
              value={randomBytes(16).toString("hex")}
            />
            <fieldset className="space-y-3 rounded-xl border border-brand-blue/25 bg-brand-blue-50/40 p-4">
              <legend className="px-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand-blue">
                Porodica boja
              </legend>
              <p className="text-xs text-ink-600">
                Prazna šifra odvaja ovu boju bez brisanja SKU-a ili istorije. Opisni podaci važe za celu porodicu; cene, akcije i statusi važe samo za ovaj SKU.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Field label="Šifra porodice">
                  <Input
                    name="familyCode"
                    defaultValue={product.familyMembership?.family.code ?? ""}
                    placeholder="npr. SMAK-UGAONA"
                  />
                </Field>
                <Field label="Naziv ove boje">
                  <Input
                    name="familyColorLabel"
                    defaultValue={
                      product.familyMembership?.label ??
                      defaultProductFamilyLabel({
                        colorPrimary: product.colorPrimary,
                        colorSecondary: product.colorSecondary,
                      })
                    }
                    placeholder="Crna / zlatna"
                  />
                </Field>
                <Field label="HEX fallback">
                  <Input
                    name="familyColorHex"
                    defaultValue={product.familyMembership?.colorHex ?? ""}
                    placeholder="#1A1A1A"
                    pattern="#[0-9A-Fa-f]{6}"
                  />
                </Field>
                <Field label="Redosled">
                  <Input
                    name="familyPosition"
                    type="number"
                    min={0}
                    defaultValue={product.familyMembership?.position ?? 0}
                  />
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="familyPrimary"
                    defaultChecked={
                      product.familyMembership?.family.primaryProductId === product.id
                    }
                  />
                  Glavna boja
                </label>
                <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="familyStorefrontEnabled"
                    defaultChecked={product.familyMembership?.storefrontEnabled ?? false}
                  />
                  Boja spremna za web
                </label>
              </div>
            </fieldset>
            <div className="rounded-xl border border-brand-blue/20 bg-brand-blue-50/40 p-3 text-sm text-ink-700">
              Puni naziv se automatski formira kao: kolekcija + kratki opis + kratki naziv.
              Trenutno: <strong>{product.name}</strong>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[140px_minmax(200px,1.4fr)_minmax(180px,1fr)_minmax(210px,0.9fr)_minmax(170px,1fr)]">
              <Field label="Šifra artikla">
                <Input
                  name="sku"
                  required
                  defaultValue={product.sku}
                  className="font-mono"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Možete uneti postojeću šifru sa magacinske deklaracije.
                </p>
              </Field>
              <Field label="Kratki opis za kartice, naziv i dokumente">
                <Textarea
                  name="shortDescription"
                  rows={2}
                  maxLength={500}
                  defaultValue={product.shortDescription ?? ""}
                />
                <p className="mt-1 text-xs text-ink-500">
                  Koristi se na karticama proizvoda, u formiranju punog naziva i u prodajnim dokumentima.
                </p>
              </Field>
              <Field label="Kratki naziv">
                <Input name="name" required defaultValue={product.shortName ?? product.name} />
              </Field>
              <Field label="Status artikla">
                <select
                  name="articleStatus"
                  defaultValue={product.articleStatus}
                  aria-describedby="article-status-hint"
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {ARTICLE_STATUS_OPTIONS.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
                <p id="article-status-hint" className="mt-1 text-xs text-ink-500">
                  DTZ nema datum isteka. UZ je neobjavljen artikal u pripremi, a ARH je arhiviran.
                </p>
              </Field>
              <Field label="Dobavljač">
                <select
                  name="supplierId"
                  defaultValue={product.supplierId ?? ""}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Bez dobavljača</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.code ? `${supplier.code} · ` : ""}{supplier.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <ProductCategorySelector
              categories={categories}
              initialSelection={categorySelection}
            />
            {categoryGroupMismatch ? (
              <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink-700">
                Interna grupa „{product.group?.name}” i javna pozicija „
                {selectedLeafCategory?.name}” se ne poklapaju. Ovaj sporni stari
                podatak neće biti automatski promenjen dok se ne promeni izbor u
                javnoj hijerarhiji.
              </div>
            ) : null}
            <fieldset className="space-y-3 rounded-xl border border-border/60 bg-muted-bg/20 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Interna kolekcija
              </legend>
              <p className="text-xs text-ink-500">
                Kolekcija učestvuje u nazivu i internom grupisanju artikala.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Kolekcija">
                <select
                  name="collectionId"
                  defaultValue={product.collectionId ?? ""}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Bez kolekcije</option>
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>{collection.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Nova kolekcija">
                <Input name="newCollectionName" placeholder="Kreira se pri čuvanju" />
              </Field>
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Field label="Bar kod">
                <Input name="barcode" defaultValue={product.barcode ?? ""} />
              </Field>
              <Field label="Veličina">
                <Input name="sizeLabel" defaultValue={product.sizeLabel ?? ""} />
              </Field>
              <Field label="Boja 1">
                <Input name="colorPrimary" list="article-colors" defaultValue={product.colorPrimary ?? ""} />
              </Field>
              <Field label="Boja 2">
                <Input name="colorSecondary" list="article-colors" defaultValue={product.colorSecondary ?? ""} />
              </Field>
            </div>
            <datalist id="article-colors">
              {lookupOptions("COLOR").map((value) => <option key={value} value={value} />)}
            </datalist>
            <div id="sifarnici" className="grid grid-cols-1 gap-3 md:grid-cols-4 scroll-mt-24">
              {(["attribute1", "attribute2", "attribute3", "attribute4"] as const).map(
                (key, index) => (
                  <Field key={key} label={`Atribut ${index + 1}`}>
                    <Input
                      name={key}
                      list="article-attributes"
                      defaultValue={product[key] ?? ""}
                    />
                  </Field>
                ),
              )}
            </div>
            <datalist id="article-attributes">
              {lookupOptions("ATTRIBUTE").map((value) => <option key={value} value={value} />)}
            </datalist>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Benefiti (odvojeni zarezom)">
                <Input
                  name="benefits"
                  list="article-benefits"
                  defaultValue={assignedValues("BENEFIT")}
                />
              </Field>
              <Field label="Sertifikati (odvojeni zarezom)">
                <Input
                  name="certificates"
                  list="article-certificates"
                  defaultValue={assignedValues("CERTIFICATE")}
                />
              </Field>
            </div>
            <datalist id="article-benefits">
              {lookupOptions("BENEFIT").map((value) => <option key={value} value={value} />)}
            </datalist>
            <datalist id="article-certificates">
              {lookupOptions("CERTIFICATE").map((value) => <option key={value} value={value} />)}
            </datalist>
            <div id="opis-za-sajt" className="scroll-mt-24">
              <Field label="Formatirani opis za sajt">
                <RichTextEditor
                  name="description"
                  required
                  productId={product.id}
                  defaultValue={sanitizeRichText(product.description)}
                />
              </Field>
            </div>
            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                PDP info sekcije
              </legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-2">
                  <Field
                    label="Posebni uslovi isporuke (opciono)"
                    hint="Ostavite prazno da bi artikal koristio standardni tekst iz Sadržaj → Uslovi isporuke. Popunite samo kada ovaj artikal ima posebne uslove."
                  >
                    <Textarea
                      name="pdpDeliveryTerms"
                      rows={3}
                      defaultValue={product.pdpDeliveryTerms ?? ""}
                    />
                  </Field>
                  <ProductAttachmentsEditor
                    productId={product.id}
                    productSku={product.sku}
                    section="DELIVERY_TERMS"
                    initialAttachments={editableAttachments}
                  />
                </div>
                <div className="flex items-center rounded-lg border border-border/60 bg-muted-bg/30 p-3">
                  <Toggle
                    name="allowsAssembly"
                    defaultChecked={product.allowsAssembly}
                    label="Dozvoljena montaža"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Field label="Deklaracija">
                  <Textarea
                    name="declaration"
                    rows={3}
                    defaultValue={product.declaration ?? ""}
                  />
                </Field>
                <ProductAttachmentsEditor
                  productId={product.id}
                  productSku={product.sku}
                  section="DECLARATION"
                  initialAttachments={editableAttachments}
                />
              </div>
              <div className="space-y-2">
                <Field label="Uputstvo za sastavljanje">
                  <Textarea
                    name="assemblyInstructions"
                    rows={3}
                    defaultValue={product.assemblyInstructions ?? ""}
                  />
                </Field>
                <ProductAttachmentsEditor
                  productId={product.id}
                  productSku={product.sku}
                  section="ASSEMBLY_INSTRUCTIONS"
                  initialAttachments={editableAttachments}
                />
              </div>
              <div className="space-y-2">
                <Field label="Kako održavati">
                  <Textarea
                    name="maintenance"
                    rows={3}
                    defaultValue={product.maintenance ?? ""}
                  />
                </Field>
                <ProductAttachmentsEditor
                  productId={product.id}
                  productSku={product.sku}
                  section="MAINTENANCE"
                  initialAttachments={editableAttachments}
                />
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Stanje">
                <Input
                  name="stock"
                  type="number"
                  min={0}
                  required
                  defaultValue={defaultWarehouseStock}
                />
                <p className="mt-1 text-xs text-ink-500">
                  {defaultWarehouse?.name ?? "Podrazumevani DC"} ·{" "}
                  <Link
                    href={`/admin/erp/artikli/${product.id}/zalihe`}
                    className="text-walnut hover:underline"
                  >
                    sva stanja i kretanja
                  </Link>
                </p>
              </Field>
              <Field label="Razlog ručne korekcije DC stanja">
                <Input
                  name="stockAdjustmentReason"
                  maxLength={500}
                  placeholder="Obavezno samo ako menjate stanje"
                />
                <p className="mt-1 text-xs text-ink-500">
                  Najmanje 3 znaka kada se fizičko stanje menja.
                </p>
              </Field>
              <div className="rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs text-ink-600">
                Promena stanja se knjiži kao auditovana korekcija. Za redovan prijem robe koristite ulaznu fakturu i prijem porudžbenice.
              </div>
            </div>

            <fieldset className="space-y-3 rounded-xl border border-brand-blue/20 bg-brand-blue-50/30 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-brand-blue">
                Cene, ulazi i isporuka — izvedeno iz izvora
              </legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                <SourceSummary
                  label="MP cena"
                  value={formatRsd(retailPrice.price)}
                  source={
                    retailPrice.source.type === "PRICE_LIST"
                      ? `Cenovnik ${retailPrice.source.priceListCode}`
                      : "Legacy cena artikla"
                  }
                  href={
                    retailPrice.source.type === "PRICE_LIST"
                      ? `/admin/cenovnici/${retailPrice.source.priceListId}?sku=${encodeURIComponent(product.sku)}`
                      : "/admin/erp/cenovnici"
                  }
                  warning={retailPrice.source.type === "LEGACY_PRODUCT"}
                />
                <SourceSummary
                  label="Akcijska cena"
                  value={
                    activeAction
                      ? formatRsd(Number(activeAction.salePrice))
                      : product.salePrice
                        ? formatRsd(num(product.salePrice))
                        : "Nema aktivne akcije"
                  }
                  source={activeAction?.action.name ?? (product.salePrice ? "Legacy fallback" : "Akcije")}
                  href="/admin/erp/akcije"
                  warning={!activeAction && Boolean(product.salePrice)}
                />
                <SourceSummary
                  label="Loyalty cena"
                  value={
                    hasActionPrice
                      ? "Ne primenjuje se zbog akcijske cene"
                      : loyaltyPrice === null
                        ? "Nema aktivnog pravila"
                        : formatRsd(loyaltyPrice)
                  }
                  source={loyaltyRule?.name ?? "Loyalty pravila"}
                  href="/admin/erp/loyalty"
                />
                <SourceSummary
                  label="U dolasku"
                  value={`${incomingStock} kom`}
                  source="Ulazne fakture / porudžbenice"
                  href="/admin/erp/ulazne-fakture"
                />
                <SourceSummary
                  label="Rok isporuke"
                  value={`${deliveryWindow.min}–${deliveryWindow.max} dana`}
                  source={availability.source === "SUPPLIER" ? "Dobavljački rok" : "DC rok"}
                  href="/admin/dostava"
                />
              </div>
            </fieldset>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Širina (cm)">
                <Input name="widthCm" type="number" min={0.01} step="0.01" required defaultValue={product.widthCm ? num(product.widthCm) : ""} />
              </Field>
              <Field label="Dubina (cm)">
                <Input name="depthCm" type="number" min={0.01} step="0.01" required defaultValue={product.depthCm ? num(product.depthCm) : ""} />
              </Field>
              <Field label="Visina (cm)">
                <Input name="heightCm" type="number" min={0.01} step="0.01" required defaultValue={product.heightCm ? num(product.heightCm) : ""} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Težina (kg)">
                <Input name="weightKg" type="number" min={0} step="0.001" defaultValue={product.weightKg ? num(product.weightKg) : ""} />
              </Field>
              <Field label="Bruto težina (kg)">
                <Input name="grossWeightKg" type="number" min={0} step="0.001" defaultValue={product.grossWeightKg ? num(product.grossWeightKg) : ""} />
              </Field>
            </div>
            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Pakovanje pojedinačnog artikla
              </legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Širina (cm)">
                  <Input name="unitPackWidthCm" type="number" min={0} step="0.01" defaultValue={product.unitPackWidthCm ? num(product.unitPackWidthCm) : ""} />
                </Field>
                <Field label="Dubina (cm)">
                  <Input name="unitPackDepthCm" type="number" min={0} step="0.01" defaultValue={product.unitPackDepthCm ? num(product.unitPackDepthCm) : ""} />
                </Field>
                <Field label="Visina (cm)">
                  <Input name="unitPackHeightCm" type="number" min={0} step="0.01" defaultValue={product.unitPackHeightCm ? num(product.unitPackHeightCm) : ""} />
                </Field>
              </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Transportno pakovanje
              </legend>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
                <Field label="Kom/pak">
                  <Input name="packQty" type="number" min={0} defaultValue={product.packQty ?? ""} />
                </Field>
                <Field label="Širina (cm)">
                  <Input name="packWidthCm" type="number" min={0} step="0.01" defaultValue={product.packWidthCm ? num(product.packWidthCm) : ""} />
                </Field>
                <Field label="Dubina (cm)">
                  <Input name="packDepthCm" type="number" min={0} step="0.01" defaultValue={product.packDepthCm ? num(product.packDepthCm) : ""} />
                </Field>
                <Field label="Visina (cm)">
                  <Input name="packHeightCm" type="number" min={0} step="0.01" defaultValue={product.packHeightCm ? num(product.packHeightCm) : ""} />
                </Field>
                <Field label="Bruto kg">
                  <Input name="packGrossWeightKg" type="number" min={0} step="0.001" defaultValue={product.packGrossWeightKg ? num(product.packGrossWeightKg) : ""} />
                </Field>
                <Field label="Količina za ceo kontejner">
                  <Input name="containerQty" type="number" min={1} step={1} defaultValue={product.containerQty ?? ""} />
                </Field>
                <Field label="Bruto kg za ceo kontejner">
                  <Input name="containerGrossWeightKg" type="number" min={0.001} step="0.001" defaultValue={product.containerGrossWeightKg ? num(product.containerGrossWeightKg) : ""} />
                </Field>
              </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Nabavka i deklaracija
              </legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Field label="COGS — iz ulaznih dokumenata">
                  <Input readOnly value={product.cogs ? formatRsd(num(product.cogs)) : "Nije obračunat"} />
                  <Link href="/admin/erp/ulazne-fakture" className="mt-1 inline-block text-xs text-walnut hover:underline">
                    Otvori ulazne fakture
                  </Link>
                </Field>
                <Field label="Dobavljačev naziv">
                  <Input name="supplierProductName" defaultValue={product.supplierProductName ?? ""} />
                </Field>
                <Field label="HS kod">
                  <Input name="hsCode" defaultValue={product.hsCode ?? ""} />
                </Field>
                <Field label="Carina %">
                  <Input name="customsRate" type="number" min={0} step="0.01" defaultValue={product.customsRate ? num(product.customsRate) : ""} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Materijal">
                  <Textarea name="materialText" rows={2} defaultValue={product.materialText ?? ""} />
                </Field>
                <Field label="Zemlja porekla">
                  <Input name="countryOfOrigin" defaultValue={product.countryOfOrigin ?? ""} />
                  <p className="mt-1 text-xs text-ink-500">
                    Ova vrednost se automatski prikazuje u deklaraciji proizvoda.
                  </p>
                </Field>
                <Field label="MOQ">
                  <Input name="moq" type="number" min={0} defaultValue={product.moq ?? ""} />
                </Field>
              </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Ananas troškovi
              </legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Posredovanje %">
                  <Input name="ananasBrokeragePct" type="number" min={0} step="0.01" defaultValue={product.ananasBrokeragePct ? num(product.ananasBrokeragePct) : ""} />
                </Field>
                <Field label="Skladištenje %">
                  <Input name="ananasStoragePct" type="number" min={0} step="0.01" defaultValue={product.ananasStoragePct ? num(product.ananasStoragePct) : ""} />
                </Field>
                <Field label="Isporuka %">
                  <Input name="ananasDeliveryPct" type="number" min={0} step="0.01" defaultValue={product.ananasDeliveryPct ? num(product.ananasDeliveryPct) : ""} />
                </Field>
              </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Komercijalni uslovi i kanali
              </legend>
              <ProductNewnessField
                value={dateInputValue(product.newUntil)}
                automaticValue={
                  product.firstPublishedAt
                    ? productNewnessDateInput(
                        defaultProductNewUntil(product.firstPublishedAt),
                      )
                    : null
                }
                automatic={product.newUntilAutomatic}
              />
              <p className="text-xs text-ink-500">
                Novi proizvodi dobijaju četiri kalendarska meseca od prvog objavljivanja.
                Ručni datum ili uklanjanje imaju prednost i dobavljački sync ih ne menja.
              </p>
              <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
                <Toggle name="availableWebManual" defaultChecked={product.availableWebManual} label="Web check" />
                <Toggle name="availableWholesaleManual" defaultChecked={product.availableWholesaleManual} label="VP check" />
                <Toggle name="availableExportManual" defaultChecked={product.availableExportManual} label="INO check" />
              </div>
              <p className="text-xs text-ink-500">
                Automatski pragovi raspoloživog stanja u DC: Web &gt; 0, VP &gt; 10, INO &gt; 20.
              </p>
            </fieldset>

            <div className="grid gap-3 rounded-xl border border-border/60 bg-muted-bg/30 p-4 text-sm md:grid-cols-3">
              <ReadOnlyFlag label="Hero meseca" enabled={product.isHero} href="/admin/erp/heroji-meseca" />
              <ReadOnlyFlag label="Google Merchant" enabled={product.inGoogleMerchant} href="/admin/oglasi" />
              <ReadOnlyFlag label="Meta katalog" enabled={product.inMetaCatalog} href="/admin/oglasi" />
            </div>

            <div className="pointer-events-none fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-40 flex justify-end sm:left-auto sm:right-8">
              <SubmitButton className="pointer-events-auto w-full min-w-48 shadow-xl sm:w-auto">
                Sačuvaj izmene
              </SubmitButton>
            </div>
            </Fragment>
          </AdminActionForm>
          </Card>
        </div>

        <div className="space-y-4">
          <Card id="piktogrami">
            <CardTitle description="Prikazuju se kao benefit kartice pored cene na stranici proizvoda (najviše 6).">
              Piktogrami proizvoda
            </CardTitle>
            {pictograms.length ? (
              <AdminActionForm action={updateProductPictograms} className="mt-4 space-y-4">
                <input type="hidden" name="productId" value={product.id} />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {pictograms.map((pictogram) => (
                    <label
                      key={pictogram.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/70 p-2 text-sm transition hover:bg-muted-bg"
                    >
                      <input
                        type="checkbox"
                        name="pictogramIds"
                        value={pictogram.id}
                        defaultChecked={product.pictograms.some(
                          (relation) => relation.pictogramId === pictogram.id,
                        )}
                        className="size-4 shrink-0 accent-walnut"
                      />
                      <Image
                        src={pictogram.iconUrl}
                        alt=""
                        width={36}
                        height={36}
                        className="size-9 shrink-0 rounded object-contain"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{pictogram.label}</span>
                        <span className="block truncate font-mono text-[10px] text-ink-500">
                          {pictogram.code}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex justify-end">
                  <SubmitButton>Sačuvaj piktograme</SubmitButton>
                </div>
              </AdminActionForm>
            ) : (
              <p className="mt-3 text-sm text-ink-500">
                Biblioteka je prazna. Prvo dodajte piktogram na stranici{" "}
                <Link href="/admin/piktogrami" className="text-walnut hover:underline">
                  Piktogrami
                </Link>.
              </p>
            )}
          </Card>

          <Card>
            <CardTitle description={product.supplier?.name ?? "—"}>
              Dobavljač
            </CardTitle>
            <p className="font-mono text-xs text-ink-500">
              Ext: {product.supplierExternalId ?? "—"}
            </p>
            <Link
              href="/admin/erp/dobavljaci"
              className="mt-3 inline-flex text-sm text-walnut hover:underline"
            >
              Otvori šifarnik dobavljača
            </Link>
            {product.supplierApprovalStatus ? (
              <p className="mt-2 text-xs text-ink-500">
                Status dobavljačkog odobrenja: {product.supplierApprovalStatus}
              </p>
            ) : null}
            {rabaluxSupplierStock ? (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">Rabalux lager</p>
                  <Link
                    href="/admin/erp/artikli?view=rabalux-stock"
                    className="text-xs text-walnut hover:underline"
                  >
                    Svi Rabalux artikli
                  </Link>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <SupplierStockStat
                    label="Prijavljeno stanje"
                    value={`${rabaluxSupplierStock.rawStock} kom`}
                  />
                  <SupplierStockStat
                    label="Za prodaju"
                    value={`${rabaluxSupplierStock.sellableStock} kom`}
                  />
                  <SupplierStockStat
                    label="Rezervisano"
                    value={`${rabaluxSupplierStock.reservedStock} kom`}
                  />
                  <SupplierStockStat
                    label="Sigurnosna rezerva"
                    value={`${rabaluxSupplierStock.safetyStock} kom`}
                  />
                  <SupplierStockStat
                    label="Status"
                    value={
                      RABALUX_SUPPLIER_STOCK_STATUS_LABELS[
                        rabaluxSupplierStock.status
                      ]
                    }
                  />
                  <SupplierStockStat
                    label="Poslednje osveženje"
                    value={
                      product.lastSupplierStockSyncAt
                        ? product.lastSupplierStockSyncAt.toLocaleString(
                            "sr-Latn-RS",
                            { timeZone: "Europe/Belgrade" },
                          )
                        : "Nije osveženo"
                    }
                  />
                </div>
                {product.supplierNextArrivalAt ? (
                  <p className="text-xs text-ink-500">
                    Najavljeni dolazak: {product.supplierNextArrivalAt.toLocaleDateString(
                      "sr-Latn-RS",
                      { timeZone: "Europe/Belgrade" },
                    )}
                  </p>
                ) : null}
                <p className="rounded-lg bg-muted-bg p-3 text-xs text-ink-600">
                  Kupcu se ne prikazuje tačan broj. Dobavljačko stanje ulazi u
                  online prodaju samo kada je sveže, odobreno i strogo veće od{" "}
                  {RABALUX_PUBLIC_STOCK_THRESHOLD} kom; zatim se oduzimaju
                  rezervacije i jedan sigurnosni komad.
                </p>
              </div>
            ) : null}
            {product.supplier?.integrationKey === "RABALUX" && product.supplierExternalId ? (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <AdminActionForm action={syncSingleRabaluxProduct} className="space-y-2">
                  <input type="hidden" name="productId" value={product.id} />
                  <Textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Razlog sync-a jednog proizvoda" />
                  <Field label={`Upišite: SYNC ${product.supplierExternalId}`}>
                    <Input name="phrase" autoComplete="off" required />
                  </Field>
                  <SubmitButton size="sm" variant="secondary">
                    Sync samo ovog proizvoda
                  </SubmitButton>
                </AdminActionForm>
                <AdminActionForm action={retryFailedRabaluxMedia} className="space-y-2">
                  <input type="hidden" name="productId" value={product.id} />
                  <Textarea name="reason" rows={2} minLength={5} maxLength={500} required placeholder="Razlog retry-a neuspelog medija" />
                  <SubmitButton size="sm" variant="secondary">
                    Retry samo neuspelog medija
                  </SubmitButton>
                </AdminActionForm>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardTitle description="Označena polja XML import neće prepisivati.">
              XML zaštita polja
            </CardTitle>
            <AdminActionForm action={updateProductSyncOverrides} className="space-y-3">
              <input type="hidden" name="productId" value={product.id} />
              <div className="grid grid-cols-1 gap-2 text-sm">
                {XML_OVERRIDE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="fields"
                      value={option.value}
                      defaultChecked={syncOverrideFields.has(option.value)}
                      className="size-4 accent-walnut"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <SubmitButton>Sačuvaj XML zaštitu</SubmitButton>
            </AdminActionForm>
          </Card>

          <Card>
            <CardTitle>Mediji ({product.media.length})</CardTitle>
            <ul className="space-y-3 text-xs">
              {product.media.map((m) => (
                <li key={m.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex gap-3">
                    {m.kind === "IMAGE" ? (
                      <Image
                        src={resolveSupabaseStorageUrl(m.thumbUrl ?? m.cardUrl ?? m.url)}
                        alt={m.alt ?? product.name}
                        width={64}
                        height={64}
                        unoptimized
                        className="size-16 rounded-md object-cover ring-1 ring-border/60"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-ink-500">
                        {m.kind} · {m.url}
                      </div>
                      <p className="mt-1 text-ink-500">
                        Redosled {m.order} · Alt: {m.alt || "—"}
                      </p>
                    </div>
                  </div>
                  <AdminActionForm action={updateProductMedia} className="mt-3 space-y-2">
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="mediaId" value={m.id} />
                    <Field label="URL / storage putanja">
                      <Input name="url" defaultValue={m.url} required />
                    </Field>
                    <div className="grid gap-2 md:grid-cols-3">
                      <Field label="Thumb URL">
                        <Input name="thumbUrl" defaultValue={m.thumbUrl ?? ""} />
                      </Field>
                      <Field label="Card URL">
                        <Input name="cardUrl" defaultValue={m.cardUrl ?? ""} />
                      </Field>
                      <Field label="PDP URL">
                        <Input name="pdpUrl" defaultValue={m.pdpUrl ?? ""} />
                      </Field>
                    </div>
                    <div className="grid grid-cols-[90px_1fr] gap-2">
                      <Field label="Redosled">
                        <Input
                          name="order"
                          type="number"
                          min={0}
                          defaultValue={m.order}
                        />
                      </Field>
                      <Field label="Alt tekst">
                        <Input name="alt" defaultValue={m.alt ?? product.name} />
                      </Field>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <SubmitButton>Sačuvaj medij</SubmitButton>
                    </div>
                  </AdminActionForm>
                  <AdminActionForm action={deleteProductMedia} className="mt-2">
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="mediaId" value={m.id} />
                    <SubmitButton variant="destructive" size="xs">
                      Obriši
                    </SubmitButton>
                  </AdminActionForm>
                </li>
              ))}
              {product.media.length === 0 ? (
                <li className="text-sm text-ink-500">Nema fotografija.</li>
              ) : null}
            </ul>
            <AdminActionForm
              action={addProductImage}
              className="mt-4 space-y-3"
            >
              <input type="hidden" name="productId" value={product.id} />
              <Field label="Upload fotografija">
                <Input name="files" type="file" accept="image/*" multiple />
                <p className="mt-1 text-xs text-ink-500">
                  Možete izabrati do 10 fotografija odjednom; redosled izbora postaje redosled galerije.
                </p>
              </Field>
              <Field label="URL fotografije">
                <Input name="url" placeholder="https://... ili /putanja/slika.jpg" />
              </Field>
              <div className="grid gap-2 md:grid-cols-3">
                <Field label="Thumb URL">
                  <Input name="thumbUrl" placeholder="variants/thumb/..." />
                </Field>
                <Field label="Card URL">
                  <Input name="cardUrl" placeholder="variants/card/..." />
                </Field>
                <Field label="PDP URL">
                  <Input name="pdpUrl" placeholder="variants/pdp/..." />
                </Field>
              </div>
              <Field label="Alt tekst">
                <Input name="alt" defaultValue={product.name} />
              </Field>
              <SubmitButton>Dodaj fotografiju</SubmitButton>
            </AdminActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}

function SourceSummary({
  label,
  value,
  source,
  href,
  warning = false,
}: {
  label: string;
  value: string;
  source: string;
  href: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-surface p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 font-semibold text-ink-900">{value}</p>
      <Link
        href={href}
        className={`mt-1 inline-block text-xs hover:underline ${warning ? "text-warning" : "text-walnut"}`}
      >
        {source} →
      </Link>
    </div>
  );
}

function SupplierStockStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="text-ink-500">{label}</div>
      <div className="mt-1 font-mono font-semibold text-ink">{value}</div>
    </div>
  );
}

function ReadOnlyFlag({
  label,
  enabled,
  href,
}: {
  label: string;
  enabled: boolean;
  href: string;
}) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-lg border border-border/60 bg-surface px-3 py-2 hover:border-walnut/40">
      <span>{label}</span>
      <span className={enabled ? "font-semibold text-success" : "text-ink-400"}>
        {enabled ? "Da" : "Ne"} →
      </span>
    </Link>
  );
}

function Toggle({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-walnut"
      />
      {label}
    </label>
  );
}
