import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DeliveryScope } from "@prisma/client";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { num } from "@/lib/api/_helpers";
import { formatRsd } from "@/lib/format";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Pravila dostave",
  robots: { index: false, follow: false },
};

const ruleSchema = z.object({
  id: z.string().optional().nullable(),
  scope: z.nativeEnum(DeliveryScope).default("GLOBAL"),
  categoryId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  cityId: z.string().optional().nullable(),
  courierPrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  truckPrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
  assemblyPrice: z
    .union([z.coerce.number().nonnegative(), z.literal("").transform(() => null)])
    .nullable()
    .optional(),
});

const upsertRule = withAdmin(
  { allowed: ["OPS"], action: "delivery.upsert", entity: "DeliveryPriceRule" },
  async (_a, formData: FormData) => {
    const parsed = ruleSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
    const d = parsed.data;
    const data = {
      scope: d.scope,
      categoryId: d.scope === "CATEGORY" ? (d.categoryId || null) : null,
      productId: d.scope === "PRODUCT" ? (d.productId || null) : null,
      cityId: d.cityId || null,
      courierPrice: d.courierPrice ?? null,
      truckPrice: d.truckPrice ?? null,
      assemblyPrice: d.assemblyPrice ?? null,
    };
    const saved = d.id
      ? await db.deliveryPriceRule.update({ where: { id: d.id }, data })
      : await db.deliveryPriceRule.create({ data });
    revalidatePath("/admin/dostava");
    return { ok: true as const, entityId: saved.id, diff: data };
  },
);

const removeRule = withAdmin(
  { allowed: ["OPS"], action: "delivery.delete", entity: "DeliveryPriceRule" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false as const, error: "Nedostaje ID." };
    await db.deliveryPriceRule.delete({ where: { id } });
    revalidatePath("/admin/dostava");
    return { ok: true as const, entityId: id };
  },
);

const toggleTruck = withAdmin(
  { allowed: ["OPS"], action: "city.toggleTruck", entity: "DeliveryCity" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    const enabled = formData.get("enabled") === "1";
    await db.deliveryCity.update({ where: { id }, data: { truckEnabled: enabled } });
    revalidatePath("/admin/dostava");
    return { ok: true as const, entityId: id, diff: { truckEnabled: enabled } };
  },
);

export default async function DeliveryPage() {
  await requireAdminAction(["OPS"]);
  const [rules, cities, categories] = await Promise.all([
    db.deliveryPriceRule.findMany({
      orderBy: [{ scope: "asc" }, { updatedAt: "desc" }],
      include: {
        category: { select: { name: true, path: true } },
        product: { select: { sku: true, name: true } },
        city: { select: { name: true } },
      },
    }),
    db.deliveryCity.findMany({ orderBy: { name: "asc" } }),
    db.category.findMany({ orderBy: { path: "asc" }, select: { id: true, name: true, path: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Pravila dostave"
        description="Cene kurira, kamiona i montaže — globalno, po kategoriji, po proizvodu, po gradu."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Dostava" }]}
      />
      <div className="space-y-6 px-8 py-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
          <Card className="p-0">
            <DataTable
              columns={[
                { key: "scope", label: "Opseg" },
                { key: "target", label: "Cilj" },
                { key: "city", label: "Grad" },
                { key: "courier", label: "Kurir", align: "right" },
                { key: "truck", label: "Kamion", align: "right" },
                { key: "assembly", label: "Montaža", align: "right" },
                { key: "actions", label: "" },
              ]}
              rows={rules.map((r) => ({
                id: r.id,
                cells: {
                  scope: r.scope,
                  target:
                    r.scope === "CATEGORY"
                      ? (r.category?.path ?? "—")
                      : r.scope === "PRODUCT"
                        ? `${r.product?.sku ?? "—"}`
                        : "—",
                  city: r.city?.name ?? "Svi",
                  courier: r.courierPrice ? formatRsd(num(r.courierPrice)) : "—",
                  truck: r.truckPrice ? formatRsd(num(r.truckPrice)) : "—",
                  assembly: r.assemblyPrice ? formatRsd(num(r.assemblyPrice)) : "—",
                  actions: (
                    <form action={removeRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                        ×
                      </SubmitButton>
                    </form>
                  ),
                },
              }))}
              empty="Nema pravila."
            />
          </Card>
          <Card>
            <CardTitle>Novo pravilo</CardTitle>
            <form action={upsertRule} className="space-y-3">
              <Field label="Opseg">
                <select
                  name="scope"
                  defaultValue="GLOBAL"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {Object.values(DeliveryScope).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Kategorija (ako CATEGORY)">
                <select
                  name="categoryId"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.path}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Proizvod ID (ako PRODUCT)">
                <Input name="productId" placeholder="cuid…" />
              </Field>
              <Field label="Grad (opciono)">
                <select
                  name="cityId"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Svi gradovi</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Kurir">
                  <Input name="courierPrice" type="number" min={0} />
                </Field>
                <Field label="Kamion">
                  <Input name="truckPrice" type="number" min={0} />
                </Field>
                <Field label="Montaža">
                  <Input name="assemblyPrice" type="number" min={0} />
                </Field>
              </div>
              <div className="flex justify-end">
                <SubmitButton>Dodaj</SubmitButton>
              </div>
            </form>
          </Card>
        </div>

        <Card>
          <CardTitle description="Toggle za kamionsku isporuku po gradu.">
            Gradovi
          </CardTitle>
          <DataTable
            columns={[
              { key: "name", label: "Grad" },
              { key: "postal", label: "Poštanski" },
              { key: "truck", label: "Kamion" },
              { key: "actions", label: "" },
            ]}
            rows={cities.map((c) => ({
              id: c.id,
              cells: {
                name: c.name,
                postal: c.postalCode ?? "—",
                truck: c.truckEnabled ? "✓" : "—",
                actions: (
                  <form action={toggleTruck}>
                    <input type="hidden" name="id" value={c.id} />
                    <input
                      type="hidden"
                      name="enabled"
                      value={c.truckEnabled ? "0" : "1"}
                    />
                    <SubmitButton variant="outline" size="xs">
                      {c.truckEnabled ? "Isključi" : "Uključi"} kamion
                    </SubmitButton>
                  </form>
                ),
              },
            }))}
            empty="Nema gradova u bazi."
          />
        </Card>
      </div>
    </>
  );
}
