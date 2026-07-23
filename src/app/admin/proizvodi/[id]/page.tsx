import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import { randomBytes } from "node:crypto";
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
import {
  composedArticleName,
  resolveArticleCategory,
  resolveNamedArticleRelation,
  syncArticleLookupAssignments,
} from "@/lib/admin/article-master.server";
import { optionalDateInput, dateInputValue } from "@/lib/article-master";
import { sanitizeRichText } from "@/lib/rich-text";
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

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Proizvod",
  robots: { index: false, follow: false },
};

const overrideSchema = z.object({
  id: z.string(),
  operationId: z.string().min(16),
  name: z.string().min(1).max(200),
  articleStatus: z.enum(["SP", "IT", "DTZ", "DOB", "ARH", "UZ"]),
  supplierId: z.string().optional().nullable(),
  groupId: z.string().optional().nullable(),
  newGroupName: z.string().max(120).optional().nullable(),
  collectionId: z.string().optional().nullable(),
  newCollectionName: z.string().max(120).optional().nullable(),
  barcode: z.string().max(80).optional().nullable(),
  sizeLabel: z.string().max(80).optional().nullable(),
  colorPrimary: z.string().max(120).optional().nullable(),
  colorSecondary: z.string().max(120).optional().nullable(),
  attribute1: z.string().max(120).optional().nullable(),
  attribute2: z.string().max(120).optional().nullable(),
  attribute3: z.string().max(120).optional().nullable(),
  attribute4: z.string().max(120).optional().nullable(),
  benefits: z.string().max(2000).optional().nullable(),
  certificates: z.string().max(2000).optional().nullable(),
  shortDescription: z.string().max(500).optional().nullable(),
  description: z.string().max(20000),
  fullPrice: z.coerce.number().nonnegative(),
  salePrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  loyaltyPrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  loyaltyDiscountPct: z
    .union([z.coerce.number().int().min(0).max(99), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  pdpDeliveryTerms: z.string().max(10000).optional().nullable(),
  declaration: z.string().max(10000).optional().nullable(),
  assemblyInstructions: z.string().max(10000).optional().nullable(),
  maintenance: z.string().max(10000).optional().nullable(),
  stock: z.coerce.number().int().min(0),
  incomingStock: z.coerce.number().int().min(0),
  widthCm: z.coerce.number().positive().max(10000),
  depthCm: z.coerce.number().positive().max(10000),
  heightCm: z.coerce.number().positive().max(10000),
  weightKg: optionalNonnegativeNumber(),
  grossWeightKg: optionalNonnegativeNumber(),
  packQty: optionalNonnegativeInteger(),
  packWidthCm: optionalNonnegativeNumber(),
  packDepthCm: optionalNonnegativeNumber(),
  packHeightCm: optionalNonnegativeNumber(),
  packGrossWeightKg: optionalNonnegativeNumber(),
  cogs: optionalNonnegativeNumber(),
  customsRate: optionalNonnegativeNumber(),
  supplierProductName: z.string().max(500).optional().nullable(),
  materialText: z.string().max(5000).optional().nullable(),
  hsCode: z.string().max(80).optional().nullable(),
  moq: optionalNonnegativeInteger(),
  ananasBrokeragePct: optionalNonnegativeNumber(),
  ananasStoragePct: optionalNonnegativeNumber(),
  ananasDeliveryPct: optionalNonnegativeNumber(),
  newUntil: z.string().max(10).optional().nullable(),
  tncFrom: z.string().max(10).optional().nullable(),
  tncUntil: z.string().max(10).optional().nullable(),
  deliveryDaysMin: z.coerce.number().int().min(0).max(60),
  deliveryDaysMax: z.coerce.number().int().min(0).max(60),
  allowsAssembly: z.coerce.boolean().default(false),
  isActive: z.coerce.boolean().default(true),
  isHero: z.coerce.boolean().default(false),
  isNew: z.coerce.boolean().default(false),
  isLimited: z.coerce.boolean().default(false),
  isDtz: z.coerce.boolean().default(false),
  inGoogleMerchant: z.coerce.boolean().default(false),
  inMetaCatalog: z.coerce.boolean().default(false),
  availableWebManual: z.coerce.boolean().default(false),
  availableWholesaleManual: z.coerce.boolean().default(false),
  availableExportManual: z.coerce.boolean().default(false),
});

const categorySchema = z.object({
  productId: z.string(),
  categoryId: z.string().optional().nullable(),
  newCategoryName: z.string().max(120).optional().nullable(),
  parentCategoryId: z.string().optional().nullable(),
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

function optionalNonnegativeInteger() {
  return z
    .union([
      z.coerce.number().int().nonnegative(),
      z.literal("").transform(() => null),
    ])
    .nullable()
    .optional();
}

const mediaSchema = z.object({
  productId: z.string(),
  url: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable()
    .refine(
      (value) =>
        !value ||
        value.startsWith("/") ||
        /^https?:\/\//.test(value),
      "URL mora biti puna adresa ili putanja koja počinje sa /.",
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
      (value) => value.startsWith("/") || /^https?:\/\//.test(value),
      "URL mora biti puna adresa ili putanja koja počinje sa /.",
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
      (value) =>
        !value ||
        value.startsWith("/") ||
        /^https?:\/\//.test(value),
      "URL mora biti puna adresa ili putanja koja počinje sa /.",
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
    },
  });
  const productSlug = slug ?? product?.slug;
  revalidatePath("/admin/proizvodi");
  revalidatePath(`/admin/proizvodi/${productId}`);
  if (productSlug) revalidatePath(`/p/${productSlug}`);
  for (const path of COMMON_PRODUCT_SURFACES) revalidatePath(path);
  for (const relation of product?.categories ?? []) {
    const categoryPath = relation.category.path.replace(/^\/+/, "");
    if (categoryPath) revalidatePath(`/k/${categoryPath}`);
  }
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

async function lockSupplierOwnedFields(
  tx: Prisma.TransactionClient,
  productId: string,
  actorId: string,
  fields: RabaluxOverrideGroup[],
) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { supplierId: true, syncOverrides: true },
  });
  if (!product?.supplierId || !fields.length) return;
  await tx.product.update({
    where: { id: productId },
    data: {
      syncOverrides: mergeOverrideFields(
        product.syncOverrides,
        fields,
        actorId,
      ),
    },
  });
}

function changedManualGroups(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const groups: Array<[RabaluxOverrideGroup, string[]]> = [
    ["name", ["name"]],
    ["identity", ["barcode"]],
    ["description", ["description", "shortDescription"]],
    ["pricing", ["fullPrice", "salePrice", "discountPct"]],
    ["specifications", ["colorPrimary", "colorSecondary"]],
    ["dimensions", ["widthCm", "depthCm", "heightCm"]],
    ["delivery", ["deliveryDaysMin", "deliveryDaysMax", "allowsAssembly"]],
    ["flags", ["isActive", "isNew", "isDtz"]],
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
          isActive: bool("isActive"),
          isHero: bool("isHero"),
          isNew: bool("isNew"),
          isLimited: bool("isLimited"),
          isDtz: bool("isDtz"),
          inGoogleMerchant: bool("inGoogleMerchant"),
          inMetaCatalog: bool("inMetaCatalog"),
          availableWebManual: bool("availableWebManual"),
          availableWholesaleManual: bool("availableWholesaleManual"),
          availableExportManual: bool("availableExportManual"),
        });
        if (!parsed.success) {
          return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        }
        const d = parsed.data;
        if (d.deliveryDaysMin > d.deliveryDaysMax) {
          return { ok: false as const, error: "Min. dani isporuke ne mogu biti veći od max." };
        }
        const newUntil = optionalDateInput(d.newUntil);
        const tncFrom = optionalDateInput(d.tncFrom);
        const tncUntil = optionalDateInput(d.tncUntil);
        if (tncFrom && tncUntil && tncFrom > tncUntil) {
          return {
            ok: false as const,
            error: "T&C datum od ne može biti posle datuma do.",
          };
        }
        const activeDateFloor = new Date();
        activeDateFloor.setHours(0, 0, 0, 0);
        const statusFlags =
          d.articleStatus === "DTZ"
            ? { isActive: true, isDtz: true, isLimited: false }
            : d.articleStatus === "IT"
              ? { isActive: true, isDtz: false, isLimited: true }
              : d.articleStatus === "ARH" || d.articleStatus === "UZ"
                ? { isActive: false, isDtz: false, isLimited: false }
                : { isActive: true, isDtz: false, isLimited: false };
        const data = {
          shortName: d.name.trim(),
          barcode: d.barcode?.trim() || null,
          sizeLabel: d.sizeLabel?.trim() || null,
          colorPrimary: d.colorPrimary?.trim() || null,
          colorSecondary: d.colorSecondary?.trim() || null,
          attribute1: d.attribute1?.trim() || null,
          attribute2: d.attribute2?.trim() || null,
          attribute3: d.attribute3?.trim() || null,
          attribute4: d.attribute4?.trim() || null,
          shortDescription: d.shortDescription || null,
          description: sanitizeRichText(d.description),
          articleStatus: d.articleStatus,
          supplierId: d.supplierId?.trim() || null,
          fullPrice: d.fullPrice,
          salePrice: d.salePrice ?? null,
          loyaltyPrice: d.loyaltyPrice ?? null,
          loyaltyDiscountPct: d.loyaltyDiscountPct ?? null,
          discountPct:
            d.salePrice && d.salePrice < d.fullPrice
              ? Math.round(((d.fullPrice - d.salePrice) / d.fullPrice) * 100)
              : d.loyaltyPrice && d.loyaltyPrice < d.fullPrice
                ? Math.round(((d.fullPrice - d.loyaltyPrice) / d.fullPrice) * 100)
                : d.loyaltyDiscountPct
                  ? d.loyaltyDiscountPct
              : null,
          pdpDeliveryTerms: d.pdpDeliveryTerms?.trim() || null,
          declaration: d.declaration?.trim() || null,
          assemblyInstructions: d.assemblyInstructions?.trim() || null,
          maintenance: d.maintenance?.trim() || null,
          incomingStock: d.incomingStock,
          widthCm: d.widthCm,
          depthCm: d.depthCm,
          heightCm: d.heightCm,
          weightKg: d.weightKg ?? null,
          grossWeightKg: d.grossWeightKg ?? null,
          packQty: d.packQty ?? null,
          packWidthCm: d.packWidthCm ?? null,
          packDepthCm: d.packDepthCm ?? null,
          packHeightCm: d.packHeightCm ?? null,
          packGrossWeightKg: d.packGrossWeightKg ?? null,
          cogs: d.cogs ?? null,
          customsRate: d.customsRate ?? null,
          supplierProductName: d.supplierProductName?.trim() || null,
          materialText: d.materialText?.trim() || null,
          hsCode: d.hsCode?.trim() || null,
          moq: d.moq ?? null,
          ananasBrokeragePct: d.ananasBrokeragePct ?? null,
          ananasStoragePct: d.ananasStoragePct ?? null,
          ananasDeliveryPct: d.ananasDeliveryPct ?? null,
          newUntil,
          tncFrom,
          tncUntil,
          deliveryDaysMin: d.deliveryDaysMin,
          deliveryDaysMax: d.deliveryDaysMax,
          allowsAssembly: d.allowsAssembly,
          ...statusFlags,
          isHero: d.isHero,
          isNew: newUntil ? newUntil >= activeDateFloor : d.isNew,
          inGoogleMerchant: d.inGoogleMerchant,
          inMetaCatalog: d.inMetaCatalog,
          availableWebManual: d.availableWebManual,
          availableWholesaleManual: d.availableWholesaleManual,
          availableExportManual: d.availableExportManual,
        };
        const updated = await db.$transaction(async (tx) => {
          const existing = await tx.product.findUniqueOrThrow({
            where: { id: d.id },
            select: {
              supplierId: true,
              supplierExternalId: true,
              supplierApprovalStatus: true,
              syncOverrides: true,
              name: true,
              barcode: true,
              description: true,
              shortDescription: true,
              fullPrice: true,
              salePrice: true,
              discountPct: true,
              colorPrimary: true,
              colorSecondary: true,
              widthCm: true,
              depthCm: true,
              heightCm: true,
              deliveryDaysMin: true,
              deliveryDaysMax: true,
              allowsAssembly: true,
              isActive: true,
              isNew: true,
              isDtz: true,
            },
          });
          const [group, collection] = await Promise.all([
            resolveNamedArticleRelation(tx, "group", {
              id: d.groupId?.trim() || null,
              name: d.newGroupName,
            }),
            resolveNamedArticleRelation(tx, "collection", {
              id: d.collectionId?.trim() || null,
              name: d.newCollectionName,
            }),
          ]);
          const completeData = {
            ...data,
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
          await syncArticleLookupAssignments(tx, d.id, {
            attributes: [d.attribute1, d.attribute2, d.attribute3, d.attribute4],
            colors: [d.colorPrimary, d.colorSecondary],
            benefits: d.benefits ?? "",
            certificates: d.certificates ?? "",
          });
          await setDefaultWarehouseStock(tx, {
            idempotencyKey: `product-edit:${d.operationId}:stock`,
            productId: d.id,
            targetQty: d.stock,
            actorId,
            note: "Ručno usklađivanje iz administracije proizvoda",
          });
          return saved;
        });
        await revalidateProductSurfaces(d.id, updated.slug);
        return {
          ok: true as const,
          entityId: d.id,
          diff: data,
          message: "Proizvod je sačuvan.",
        };
      },
  )(formData);
}

async function updateProductCategory(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.category.update", entity: "Product" },
    async (actorId, formData: FormData) => {
      const parsed = categorySchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, categoryId, newCategoryName, parentCategoryId } = parsed.data;
      if (!categoryId && !newCategoryName?.trim()) {
        return { ok: false as const, error: "Izaberite ili unesite novu kategoriju." };
      }
      await db.$transaction(async (tx) => {
        const category = await resolveArticleCategory(tx, {
          id: categoryId?.trim() || null,
          name: newCategoryName,
          parentId: parentCategoryId?.trim() || null,
        });
        if (!category) throw new Error("Kategorija nije izabrana.");
        await tx.productCategory.deleteMany({ where: { productId } });
        await tx.productCategory.create({
          data: { productId, categoryId: category.id },
        });
        await lockSupplierOwnedFields(tx, productId, actorId, ["categories"]);
        await tx.product.updateMany({
          where: {
            id: productId,
            supplierId: { not: null },
            supplierApprovalStatus: "PENDING_MAPPING",
          },
          data: {
            supplierApprovalStatus: "PENDING_APPROVAL",
            isActive: false,
          },
        });
      });
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: productId,
        diff: { categoryId, newCategoryName, parentCategoryId },
        message: "Kategorija proizvoda je sačuvana.",
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
      const file = formData.get("file");
      let url = parsed.data.url?.trim() || "";
      if (file instanceof File && file.size > 0) {
        try {
          url = await uploadProductImage(productId, file);
        } catch (err) {
          return {
            ok: false as const,
            error: err instanceof Error ? err.message : "Upload fotografije nije uspeo.",
          };
        }
      }
      if (!url) {
        return { ok: false as const, error: "Dodajte URL ili upload fotografiju." };
      }
      const last = await db.productMedia.aggregate({
        where: { productId },
        _max: { order: true },
      });
      const media = await db.$transaction(async (tx) => {
        const created = await tx.productMedia.create({
          data: {
            productId,
            url,
            thumbUrl: thumbUrl?.trim() || null,
            cardUrl: cardUrl?.trim() || null,
            pdpUrl: pdpUrl?.trim() || null,
            alt: alt?.trim() || null,
            order: (last._max.order ?? -1) + 1,
          },
          select: { id: true },
        });
        await lockSupplierOwnedFields(tx, productId, actorId, ["media"]);
        return created;
      });
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: media.id,
        diff: { productId, url },
        message: "Fotografija je dodata.",
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

export default async function ProductDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const { id } = await params;
  const [product, categories, suppliers, groups, collections, lookupValues, defaultWarehouse] =
    await Promise.all([
      db.product.findUnique({
        where: { id },
        include: {
          categories: { include: { category: true } },
          pictograms: { include: { pictogram: true } },
          media: { orderBy: { order: "asc" } },
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
        },
      }),
      db.category.findMany({
        orderBy: [{ level: "asc" }, { name: "asc" }],
        select: { id: true, name: true, path: true, level: true },
      }),
      db.supplier.findMany({
        where: { enabled: true },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true, parity: true, deliveryDays: true },
      }),
      db.group.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      db.collection.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.productLookupValue.findMany({
        where: { active: true },
        orderBy: [{ kind: "asc" }, { value: "asc" }],
        select: { kind: true, value: true },
      }),
      db.warehouse.findFirst({
        where: { active: true, isDefault: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      }),
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

  return (
    <>
      <PageHeader
        title={product.name}
        description={`SKU ${product.sku}`}
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/proizvodi", label: "Proizvodi" },
          { label: product.sku },
        ]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardTitle description="Override-i preko XML feed-a — ovo polje sledeći import može da prepiše ako je polje označeno kao auto-sync.">
            Osnovni podaci
          </CardTitle>
          <AdminActionForm action={updateProduct} className="space-y-4">
            <input type="hidden" name="id" value={product.id} />
            <input
              type="hidden"
              name="operationId"
              value={randomBytes(16).toString("hex")}
            />
            <div className="rounded-xl border border-brand-blue/20 bg-brand-blue-50/40 p-3 text-sm text-ink-700">
              Puni naziv se automatski formira kao: kolekcija + kratki opis + kratki naziv.
              Trenutno: <strong>{product.name}</strong>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Kratki naziv">
                <Input name="name" required defaultValue={product.shortName ?? product.name} />
              </Field>
              <Field label="Status artikla">
                <select
                  name="articleStatus"
                  defaultValue={product.articleStatus}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {["SP", "IT", "DTZ", "DOB", "ARH", "UZ"].map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Field label="Grupa">
                <select
                  name="groupId"
                  defaultValue={product.groupId ?? ""}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Bez grupe</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Nova grupa">
                <Input name="newGroupName" placeholder="Kreira se pri čuvanju" />
              </Field>
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
            <Field label="Kratak opis">
              <Textarea
                name="shortDescription"
                rows={2}
                defaultValue={product.shortDescription ?? ""}
              />
            </Field>
            <div id="opis-za-sajt" className="scroll-mt-24">
              <Field label="Formatirani opis za sajt">
                <RichTextEditor
                  name="description"
                  required
                  defaultValue={sanitizeRichText(product.description)}
                />
              </Field>
            </div>
            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                PDP info sekcije
              </legend>
              <Field label="Uslovi isporuke">
                <Textarea
                  name="pdpDeliveryTerms"
                  rows={3}
                  defaultValue={product.pdpDeliveryTerms ?? ""}
                />
              </Field>
              <Field label="Deklaracija">
                <Textarea
                  name="declaration"
                  rows={3}
                  defaultValue={product.declaration ?? ""}
                />
              </Field>
              <Field label="Uputstvo za sastavljanje">
                <Textarea
                  name="assemblyInstructions"
                  rows={3}
                  defaultValue={product.assemblyInstructions ?? ""}
                />
              </Field>
              <Field label="Kako održavati">
                <Textarea
                  name="maintenance"
                  rows={3}
                  defaultValue={product.maintenance ?? ""}
                />
              </Field>
            </fieldset>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Puna cena (RSD)">
                <Input
                  name="fullPrice"
                  type="number"
                  step="1"
                  min={0}
                  required
                  defaultValue={num(product.fullPrice)}
                />
              </Field>
              <Field label="Akcijska cena (RSD)">
                <Input
                  name="salePrice"
                  type="number"
                  step="1"
                  min={0}
                  defaultValue={
                    product.salePrice ? num(product.salePrice) : ""
                  }
                />
              </Field>
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
            </div>

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
                Pakovanje
              </legend>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
              </div>
            </fieldset>
            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Nabavka i deklaracija
              </legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <Field label="COGS">
                  <Input name="cogs" type="number" min={0} step="0.01" defaultValue={product.cogs ? num(product.cogs) : ""} />
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
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="Materijal">
                  <Textarea name="materialText" rows={2} defaultValue={product.materialText ?? ""} />
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Loyalty cena (RSD)">
                <Input
                  name="loyaltyPrice"
                  type="number"
                  step="1"
                  min={0}
                  defaultValue={
                    product.loyaltyPrice ? num(product.loyaltyPrice) : ""
                  }
                />
              </Field>
              <Field label="Loyalty popust (%)">
                <Input
                  name="loyaltyDiscountPct"
                  type="number"
                  step="1"
                  min={0}
                  max={99}
                  defaultValue={product.loyaltyDiscountPct ?? ""}
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Ulazi (komada)">
                <Input
                  name="incomingStock"
                  type="number"
                  min={0}
                  defaultValue={product.incomingStock}
                />
              </Field>
              <Field label="Min. dani isporuke">
                <Input
                  name="deliveryDaysMin"
                  type="number"
                  min={0}
                  defaultValue={product.deliveryDaysMin}
                />
              </Field>
              <Field label="Max. dani isporuke">
                <Input
                  name="deliveryDaysMax"
                  type="number"
                  min={0}
                  defaultValue={product.deliveryDaysMax}
                />
              </Field>
            </div>

            <fieldset className="space-y-3 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Komercijalni uslovi i kanali
              </legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Field label="Paritet (nasleđen od dobavljača)">
                  <Input readOnly value={product.supplier?.parity ?? "—"} />
                </Field>
                <Field label="Rok isporuke (nasleđen)">
                  <Input
                    readOnly
                    value={
                      product.supplier?.deliveryDays != null
                        ? `${product.supplier.deliveryDays} dana`
                        : "—"
                    }
                  />
                </Field>
                <Field label="Novo do">
                  <Input name="newUntil" type="date" defaultValue={dateInputValue(product.newUntil)} />
                </Field>
                <Field label="T&C od">
                  <Input name="tncFrom" type="date" defaultValue={dateInputValue(product.tncFrom)} />
                </Field>
                <Field label="T&C do">
                  <Input name="tncUntil" type="date" defaultValue={dateInputValue(product.tncUntil)} />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
                <Toggle name="availableWebManual" defaultChecked={product.availableWebManual} label="Web check" />
                <Toggle name="availableWholesaleManual" defaultChecked={product.availableWholesaleManual} label="VP check" />
                <Toggle name="availableExportManual" defaultChecked={product.availableExportManual} label="INO check" />
              </div>
              <p className="text-xs text-ink-500">
                Automatski pragovi raspoloživog stanja u DC: Web &gt; 0, VP &gt; 10, INO &gt; 20.
              </p>
            </fieldset>

            <fieldset className="space-y-2 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Oznake
              </legend>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Toggle name="isHero" defaultChecked={product.isHero} label="Hero meseca" />
                <Toggle name="isNew" defaultChecked={product.isNew} label="Novo" />
                <Toggle name="allowsAssembly" defaultChecked={product.allowsAssembly} label="Dozvoljena montaža" />
                <Toggle
                  name="inGoogleMerchant"
                  defaultChecked={product.inGoogleMerchant}
                  label="Google Merchant"
                />
                <Toggle
                  name="inMetaCatalog"
                  defaultChecked={product.inMetaCatalog}
                  label="Meta katalog"
                />
              </div>
            </fieldset>

            <div className="flex justify-end">
              <SubmitButton>Sačuvaj izmene</SubmitButton>
            </div>
          </AdminActionForm>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardTitle>Kategorije</CardTitle>
            <ul className="space-y-1 text-sm">
              {product.categories.map((c) => (
                <li key={c.categoryId} className="font-mono text-xs text-ink-500">
                  {c.category.path}
                </li>
              ))}
              {product.categories.length === 0 ? (
                <li className="text-sm text-ink-500">Bez kategorija.</li>
              ) : null}
            </ul>
            <AdminActionForm action={updateProductCategory} className="mt-4 space-y-3">
              <input type="hidden" name="productId" value={product.id} />
              <Field label="Promeni kategoriju">
                <select
                  name="categoryId"
                  defaultValue={product.categories[0]?.categoryId ?? ""}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Nova kategorija / bez izbora</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.path}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Nova kategorija">
                <Input name="newCategoryName" placeholder="Naziv nove kategorije" />
              </Field>
              <Field label="Nadređena kategorija za novu">
                <select
                  name="parentCategoryId"
                  defaultValue={product.categories[0]?.category.parentId ?? ""}
                  className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Korenska kategorija</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.path}
                    </option>
                  ))}
                </select>
              </Field>
              <SubmitButton>Sačuvaj kategoriju</SubmitButton>
            </AdminActionForm>
          </Card>

          <Card id="mediji">
            <CardTitle>Piktogrami</CardTitle>
            <div className="flex flex-wrap gap-2 text-xs">
              {product.pictograms.map((p) => (
                <span
                  key={p.pictogramId}
                  className="rounded-full bg-muted-bg px-2 py-0.5"
                >
                  {p.pictogram.label}
                </span>
              ))}
              {product.pictograms.length === 0 ? (
                <span className="text-sm text-ink-500">Nema dodeljenih piktograma.</span>
              ) : null}
            </div>
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
              <Field label="Upload fotografije">
                <Input name="file" type="file" accept="image/*" />
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
