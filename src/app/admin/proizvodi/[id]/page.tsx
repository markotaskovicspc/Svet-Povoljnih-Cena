import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import Image from "next/image";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { num } from "@/lib/api/_helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
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

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Proizvod",
  robots: { index: false, follow: false },
};

const overrideSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  barcode: z.string().max(80).optional().nullable(),
  sizeLabel: z.string().max(80).optional().nullable(),
  colorPrimary: z.string().max(120).optional().nullable(),
  colorSecondary: z.string().max(120).optional().nullable(),
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
});

const categorySchema = z.object({
  productId: z.string(),
  categoryId: z.string().min(1),
});

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

const XML_OVERRIDE_OPTIONS = [
  { value: "identity", label: "SKU / barkod / eksterni ID" },
  { value: "name", label: "Naziv" },
  { value: "description", label: "Opisi i PDP tekstovi" },
  { value: "pricing", label: "Cene i akcije" },
  { value: "stock", label: "Zalihe i ulaz" },
  { value: "flags", label: "Statusi i kanali prodaje" },
  { value: "dimensions", label: "Dimenzije" },
  { value: "delivery", label: "Isporuka i montaža" },
  { value: "grouping", label: "Grupa i kolekcija" },
  { value: "categories", label: "Kategorije" },
  { value: "media", label: "Fotografije" },
  { value: "pictograms", label: "Piktogrami" },
  { value: "materials", label: "Materijali" },
] as const;

type XmlOverrideValue = (typeof XML_OVERRIDE_OPTIONS)[number]["value"];

const XML_OVERRIDE_VALUES = new Set(XML_OVERRIDE_OPTIONS.map((option) => option.value));

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

async function updateProduct(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.update", entity: "Product" },
    async (_a, formData: FormData) => {
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
        });
        if (!parsed.success) {
          return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        }
        const d = parsed.data;
        if (d.deliveryDaysMin > d.deliveryDaysMax) {
          return { ok: false as const, error: "Min. dani isporuke ne mogu biti veći od max." };
        }
        const data = {
          name: d.name,
          barcode: d.barcode?.trim() || null,
          sizeLabel: d.sizeLabel?.trim() || null,
          colorPrimary: d.colorPrimary?.trim() || null,
          colorSecondary: d.colorSecondary?.trim() || null,
          shortDescription: d.shortDescription || null,
          description: d.description,
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
          stock: d.stock,
          incomingStock: d.incomingStock,
          deliveryDaysMin: d.deliveryDaysMin,
          deliveryDaysMax: d.deliveryDaysMax,
          allowsAssembly: d.allowsAssembly,
          isActive: d.isActive,
          isHero: d.isHero,
          isNew: d.isNew,
          isLimited: d.isLimited,
          isDtz: d.isDtz,
          inGoogleMerchant: d.inGoogleMerchant,
          inMetaCatalog: d.inMetaCatalog,
        };
        const updated = await db.product.update({
          where: { id: d.id },
          data,
          select: { slug: true },
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
    async (_a, formData: FormData) => {
      const parsed = categorySchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, categoryId } = parsed.data;
      await db.$transaction(async (tx) => {
        await tx.productCategory.deleteMany({ where: { productId } });
        await tx.productCategory.create({ data: { productId, categoryId } });
      });
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: productId,
        diff: { categoryId },
        message: "Kategorija proizvoda je sačuvana.",
      };
    },
  )(formData);
}

async function addProductImage(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT", "OPS"], action: "product.media.create", entity: "ProductMedia" },
    async (_a, formData: FormData) => {
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
      const media = await db.productMedia.create({
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
    async (_a, formData: FormData) => {
      const parsed = mediaUpdateSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, mediaId, url, thumbUrl, cardUrl, pdpUrl, alt, order } = parsed.data;
      await db.productMedia.updateMany({
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
    async (_a, formData: FormData) => {
      const parsed = mediaDeleteSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, mediaId } = parsed.data;
      await db.productMedia.deleteMany({ where: { id: mediaId, productId } });
      await revalidateProductSurfaces(productId);
      return {
        ok: true as const,
        entityId: mediaId,
        diff: { productId },
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

function readSyncOverrideFields(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return new Set<string>();
  const fields = (value as Record<string, Prisma.JsonValue>).fields;
  if (!Array.isArray(fields)) return new Set<string>();
  return new Set(fields.filter((field): field is string => typeof field === "string"));
}

export default async function ProductDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminAction(["CONTENT", "OPS"]);
  const { id } = await params;
  const product = await db.product.findUnique({
    where: { id },
    include: {
      categories: { include: { category: true } },
      pictograms: { include: { pictogram: true } },
      media: { orderBy: { order: "asc" } },
      supplier: true,
    },
  });
  if (!product) notFound();
  const syncOverrideFields = readSyncOverrideFields(product.syncOverrides);
  const categories = await db.category.findMany({
    orderBy: [{ level: "asc" }, { name: "asc" }],
    select: { id: true, name: true, path: true },
  });

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
            <Field label="Naziv">
              <Input name="name" required defaultValue={product.name} />
            </Field>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Field label="Bar kod">
                <Input name="barcode" defaultValue={product.barcode ?? ""} />
              </Field>
              <Field label="Veličina">
                <Input name="sizeLabel" defaultValue={product.sizeLabel ?? ""} />
              </Field>
              <Field label="Boja 1">
                <Input name="colorPrimary" defaultValue={product.colorPrimary ?? ""} />
              </Field>
              <Field label="Boja 2">
                <Input name="colorSecondary" defaultValue={product.colorSecondary ?? ""} />
              </Field>
            </div>
            <Field label="Kratak opis">
              <Textarea
                name="shortDescription"
                rows={2}
                defaultValue={product.shortDescription ?? ""}
              />
            </Field>
            <Field label="Opis">
              <Textarea
                name="description"
                rows={6}
                required
                defaultValue={product.description}
              />
            </Field>
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
                  defaultValue={product.stock}
                />
              </Field>
            </div>
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

            <fieldset className="space-y-2 rounded-xl border border-border/60 p-4">
              <legend className="px-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-500">
                Oznake
              </legend>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Toggle name="isActive" defaultChecked={product.isActive} label="Aktivan" />
                <Toggle name="isHero" defaultChecked={product.isHero} label="Hero meseca" />
                <Toggle name="isNew" defaultChecked={product.isNew} label="Novo" />
                <Toggle name="isLimited" defaultChecked={product.isLimited} label="Ograničena ponuda" />
                <Toggle name="isDtz" defaultChecked={product.isDtz} label="Dok traju zalihe" />
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
                  required
                >
                  <option value="" disabled>
                    Izaberi kategoriju
                  </option>
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

          <Card>
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
