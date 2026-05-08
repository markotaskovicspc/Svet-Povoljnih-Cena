import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Heroji meseca",
  robots: { index: false, follow: false },
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "Maj", "Jun",
  "Jul", "Avg", "Sep", "Okt", "Nov", "Dec",
];

const schema = z.object({
  productSku: z.string().min(1).max(64),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2024).max(2100),
  order: z.coerce.number().int().min(0).default(0),
  actionId: z.string().optional().nullable(),
});

const upsert = withAdmin(
  { allowed: ["CONTENT"], action: "hero.upsert", entity: "HeroOfMonth" },
  async (_a, formData: FormData) => {
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
    const data = {
      ...parsed.data,
      actionId: parsed.data.actionId || null,
    };
    const product = await db.product.findUnique({ where: { sku: data.productSku } });
    if (!product) return { ok: false as const, error: "SKU nije pronađen u katalogu." };

    const saved = await db.heroOfMonth.upsert({
      where: {
        productSku_month_year: {
          productSku: data.productSku,
          month: data.month,
          year: data.year,
        },
      },
      create: data,
      update: data,
    });
    revalidatePath("/admin/heroji");
    revalidatePath("/heroji-meseca");
    return { ok: true as const, entityId: saved.id, diff: data };
  },
);

const remove = withAdmin(
  { allowed: ["CONTENT"], action: "hero.delete", entity: "HeroOfMonth" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false as const, error: "Nedostaje ID." };
    await db.heroOfMonth.delete({ where: { id } });
    revalidatePath("/admin/heroji");
    revalidatePath("/heroji-meseca");
    return { ok: true as const, entityId: id };
  },
);

export default async function HeroesPage() {
  await requireAdminAction(["CONTENT"]);
  const now = new Date();
  const [heroes, actions] = await Promise.all([
    db.heroOfMonth.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }, { order: "asc" }],
      take: 50,
      include: { action: { select: { name: true } } },
    }),
    db.action.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Heroji meseca"
        description={'Istaknuti proizvodi koji se prikazuju na početnoj i u sekciji „Heroji meseca".'}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Heroji" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-[1fr_400px]">
        <Card className="p-0">
          <DataTable
            columns={[
              { key: "month", label: "Mesec" },
              { key: "sku", label: "SKU" },
              { key: "action", label: "Akcija" },
              { key: "order", label: "Red.", align: "right" },
              { key: "actions", label: "" },
            ]}
            rows={heroes.map((h) => ({
              id: h.id,
              cells: {
                month: `${MONTHS[h.month - 1]} ${h.year}`,
                sku: <span className="font-mono text-xs">{h.productSku}</span>,
                action: h.action?.name ?? "—",
                order: h.order,
                actions: (
                  <form action={remove}>
                    <input type="hidden" name="id" value={h.id} />
                    <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                      Obriši
                    </SubmitButton>
                  </form>
                ),
              },
            }))}
            empty="Još nema heroja."
          />
        </Card>
        <Card>
          <CardTitle>Dodaj heroja</CardTitle>
          <form action={upsert} className="space-y-3">
            <Field label="SKU proizvoda">
              <Input name="productSku" required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mesec">
                <select
                  name="month"
                  defaultValue={now.getMonth() + 1}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Godina">
                <Input
                  name="year"
                  type="number"
                  min={2024}
                  max={2100}
                  defaultValue={now.getFullYear()}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Akcija (opciono)">
                <select
                  name="actionId"
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">— Nijedna —</option>
                  {actions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Redosled">
                <Input name="order" type="number" min={0} defaultValue={0} />
              </Field>
            </div>
            <div className="flex justify-end">
              <SubmitButton>Sačuvaj</SubmitButton>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
