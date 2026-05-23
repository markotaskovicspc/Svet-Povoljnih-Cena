import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/admin/submit-button";

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
  url: z.string().url().max(2000),
  alt: z.string().max(200).optional().nullable(),
});

const mediaDeleteSchema = z.object({
  productId: z.string(),
  mediaId: z.string(),
});

async function updateProduct(formData: FormData) {
  "use server";

  return withAdmin(
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
        await db.product.update({ where: { id: d.id }, data });
        revalidatePath("/admin/proizvodi");
        revalidatePath(`/admin/proizvodi/${d.id}`);
        revalidatePath("/");
        return { ok: true as const, entityId: d.id, diff: data };
      },
  )(formData);
}

async function updateProductCategory(formData: FormData) {
  "use server";

  return withAdmin(
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
      revalidatePath("/admin/proizvodi");
      revalidatePath(`/admin/proizvodi/${productId}`);
      revalidatePath("/");
      return { ok: true as const, entityId: productId, diff: { categoryId } };
    },
  )(formData);
}

async function addProductImage(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT", "OPS"], action: "product.media.create", entity: "ProductMedia" },
    async (_a, formData: FormData) => {
      const parsed = mediaSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, url, alt } = parsed.data;
      const last = await db.productMedia.aggregate({
        where: { productId },
        _max: { order: true },
      });
      const media = await db.productMedia.create({
        data: {
          productId,
          url,
          alt: alt?.trim() || null,
          order: (last._max.order ?? -1) + 1,
        },
        select: { id: true },
      });
      revalidatePath("/admin/proizvodi");
      revalidatePath(`/admin/proizvodi/${productId}`);
      revalidatePath("/");
      return { ok: true as const, entityId: media.id, diff: { productId, url } };
    },
  )(formData);
}

async function deleteProductMedia(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT", "OPS"], action: "product.media.delete", entity: "ProductMedia" },
    async (_a, formData: FormData) => {
      const parsed = mediaDeleteSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
      }
      const { productId, mediaId } = parsed.data;
      await db.productMedia.deleteMany({ where: { id: mediaId, productId } });
      revalidatePath("/admin/proizvodi");
      revalidatePath(`/admin/proizvodi/${productId}`);
      revalidatePath("/");
      return { ok: true as const, entityId: mediaId, diff: { productId } };
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
          <form action={updateProduct} className="space-y-4">
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
                <Toggle name="isLimited" defaultChecked={product.isLimited} label="Dok traju zalihe" />
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
          </form>
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
            <form action={updateProductCategory} className="mt-4 space-y-3">
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
            </form>
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
            <CardTitle>Mediji ({product.media.length})</CardTitle>
            <ul className="space-y-2 text-xs">
              {product.media.map((m) => (
                <li key={m.id} className="rounded-lg border border-border/60 p-2">
                  <div className="truncate font-mono text-ink-500">
                    {m.kind} · {m.url}
                  </div>
                  <form action={deleteProductMedia} className="mt-2">
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="mediaId" value={m.id} />
                    <button type="submit" className="text-danger hover:underline">
                      Obriši
                    </button>
                  </form>
                </li>
              ))}
              {product.media.length === 0 ? (
                <li className="text-sm text-ink-500">Nema fotografija.</li>
              ) : null}
            </ul>
            <form action={addProductImage} className="mt-4 space-y-3">
              <input type="hidden" name="productId" value={product.id} />
              <Field label="URL fotografije">
                <Input name="url" type="url" placeholder="https://..." required />
              </Field>
              <Field label="Alt tekst">
                <Input name="alt" defaultValue={product.name} />
              </Field>
              <SubmitButton>Dodaj fotografiju</SubmitButton>
            </form>
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
