import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Navigacija",
  robots: { index: false, follow: false },
};

const schema = z.object({
  id: z.string().optional().nullable(),
  label: z.string().min(1).max(40),
  href: z.string().min(1).max(200),
  icon: z.string().max(40).optional().nullable(),
  order: z.coerce.number().int().min(0).max(9999).default(0),
  enabled: z.coerce.boolean().default(true),
});

async function upsert(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT"], action: "tab.upsert", entity: "Tab" },
    async (_a, formData: FormData) => {
        const parsed = schema.safeParse({
          ...Object.fromEntries(formData),
          enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
        });
        if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        // Navigation can expose up to six commercial tabs; the first four by
        // order are also shown as mobile shortcuts below the homepage hero.
        if (parsed.data.enabled) {
          const enabledCount = await db.tab.count({
            where: { enabled: true, NOT: parsed.data.id ? { id: parsed.data.id } : undefined },
          });
          if (enabledCount >= 6) {
            return { ok: false as const, error: "Maksimalno 6 aktivnih tabova — isključite jedan pre dodavanja." };
          }
        }
        const { id, ...rest } = parsed.data;
        const data = { ...rest, icon: rest.icon || null };
        const saved = id
          ? await db.tab.update({ where: { id }, data })
          : await db.tab.create({ data });
        revalidatePath("/admin/tabovi");
        revalidatePath("/");
        return { ok: true as const, entityId: saved.id, diff: data };
      },
  )(formData);
}

async function remove(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "tab.delete", entity: "Tab" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.tab.delete({ where: { id } });
        revalidatePath("/admin/tabovi");
        revalidatePath("/");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

export default async function TabsPage() {
  await requireAdminAction(["CONTENT"]);
  const tabs = await db.tab.findMany({ orderBy: [{ order: "asc" }, { label: "asc" }] });

  return (
    <>
      <PageHeader
        title="Navigacija"
        description="Glavna navigacija ispod pretrage. Na mobilnoj početnoj, prva 4 aktivna taba po redosledu se prikazuju odmah ispod glavnog banera."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Navigacija" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-0">
          <DataTable
            columns={[
              { key: "label", label: "Naziv" },
              { key: "href", label: "Link" },
              { key: "order", label: "Red.", align: "right" },
              { key: "enabled", label: "Aktivan", align: "center" },
              { key: "actions", label: "" },
            ]}
            rows={tabs.map((t) => ({
              id: t.id,
              cells: {
                label: <span className="font-medium">{t.label}</span>,
                href: <span className="font-mono text-xs">{t.href}</span>,
                order: t.order,
                enabled: t.enabled ? "✓" : "—",
                actions: (
                  <div className="flex gap-2">
                    <a href={`#edit-${t.id}`} className="text-xs text-walnut hover:underline">
                      Izmeni
                    </a>
                    <form action={remove}>
                      <input type="hidden" name="id" value={t.id} />
                      <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                        Obriši
                      </SubmitButton>
                    </form>
                  </div>
                ),
              },
            }))}
            empty="Nema tabova."
          />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardTitle>Novi tab</CardTitle>
            <TabForm action={upsert} />
          </Card>
          {tabs.map((t) => (
            <Card key={t.id} id={`edit-${t.id}`} className="scroll-mt-24">
              <CardTitle>Izmena: {t.label}</CardTitle>
              <TabForm action={upsert} values={t} />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

function TabForm({
  action,
  values,
}: {
  action: (
    state: AdminActionState,
    formData: FormData,
  ) => Promise<AdminActionState>;
  values?: { id?: string; label?: string; href?: string; icon?: string | null; order?: number; enabled?: boolean };
}) {
  return (
    <AdminActionForm action={action} className="space-y-3">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Naziv">
        <Input name="label" required defaultValue={values?.label ?? ""} />
      </Field>
      <Field label="Link">
        <Input name="href" required defaultValue={values?.href ?? ""} placeholder="/k/namestaj" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ikona (opciono)">
          <Input name="icon" defaultValue={values?.icon ?? ""} placeholder="lucide ime" />
        </Field>
        <Field label="Redosled">
          <Input name="order" type="number" min={0} defaultValue={values?.order ?? 0} />
        </Field>
      </div>
      <Field label="Aktivan">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={values?.enabled ?? true} className="size-4 accent-walnut" />
          Prikaži u meniju
        </label>
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj"}</SubmitButton>
      </div>
    </AdminActionForm>
  );
}
