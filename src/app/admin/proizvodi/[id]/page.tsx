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
  shortDescription: z.string().max(500).optional().nullable(),
  description: z.string().max(20000),
  fullPrice: z.coerce.number().nonnegative(),
  salePrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
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
          shortDescription: d.shortDescription || null,
          description: d.description,
          fullPrice: d.fullPrice,
          salePrice: d.salePrice ?? null,
          discountPct:
            d.salePrice && d.salePrice < d.fullPrice
              ? Math.round(((d.fullPrice - d.salePrice) / d.fullPrice) * 100)
              : null,
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
                <Toggle name="isLimited" defaultChecked={product.isLimited} label="Ograničena količina" />
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
            <ul className="space-y-1 text-xs">
              {product.media.slice(0, 6).map((m) => (
                <li key={m.id} className="truncate font-mono text-ink-500">
                  {m.kind} · {m.url}
                </li>
              ))}
            </ul>
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
