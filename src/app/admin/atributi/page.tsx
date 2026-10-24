import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath, updateTag } from "next/cache";
import { db } from "@/lib/db";
import { requireAdminAction, withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Atributi", robots: { index: false, follow: false } };
const schema = z.object({
  id: z.string().optional(), sectionId: z.string().optional(),
  name: z.string().trim().min(1, "Unesite naziv.").max(120),
  order: z.coerce.number().int().min(0).max(100000),
});

async function save(_state: AdminActionState, formData: FormData) {
  "use server";
  return withAdminState(
    { allowed: ["CONTENT"], action: "attribute.save", entity: "AttributeSection" },
    async (_actorId, form: FormData) => {
      const parsed = schema.safeParse(Object.fromEntries(form.entries()));
      if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Proverite unos." };
      const data = parsed.data;
      const active = form.get("active") === "on";
      let row: { id: string };
      try {
        row = data.sectionId
        ? data.id
          ? await db.attributeOption.update({ where: { id: data.id, sectionId: data.sectionId },
              data: { value: data.name, order: data.order, active } })
          : await db.attributeOption.create({ data: {
              sectionId: data.sectionId, value: data.name, order: data.order, active } })
        : data.id
          ? await db.attributeSection.update({ where: { id: data.id },
              data: { name: data.name, order: data.order, active } })
          : await db.attributeSection.create({ data: { name: data.name, order: data.order, active } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { ok: false as const, error: data.sectionId
            ? "Ta vrednost već postoji u ovoj celini." : "Celina sa tim nazivom već postoji." };
        }
        throw error;
      }
      revalidatePath("/admin/atributi");
      updateTag("catalog-products");
      return { ok: true as const, entityId: row.id, diff: { ...data, active },
        message: "Atribut je sačuvan." };
    },
  )(formData);
}

function AttributeForm({ id, sectionId, name = "", order = 0, active = true }: {
  id?: string; sectionId?: string; name?: string; order?: number; active?: boolean;
}) {
  return <AdminActionForm action={save} preserveValues={Boolean(id)} className="flex flex-wrap items-end gap-3">
    {id ? <input type="hidden" name="id" value={id} /> : null}
    {sectionId ? <input type="hidden" name="sectionId" value={sectionId} /> : null}
    <Field label={sectionId ? "Vrednost" : "Naziv celine"}>
      <Input name="name" required maxLength={120} defaultValue={name} />
    </Field>
    <Field label="Redosled"><Input name="order" type="number" min={0} max={100000} defaultValue={order} className="w-24" /></Field>
    <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={active} />Aktivna</label>
    <SubmitButton>{id ? "Sačuvaj" : sectionId ? "Dodaj vrednost" : "Dodaj celinu"}</SubmitButton>
  </AdminActionForm>;
}

export default async function AttributesPage() {
  await requireAdminAction(["CONTENT"]);
  const sections = await db.attributeSection.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: { options: { orderBy: [{ order: "asc" }, { value: "asc" }],
      include: { _count: { select: { assignments: true } } } } },
  });
  return <div className="space-y-6">
    <PageHeader title="Atributi" description="Celine i vrednosti koje birate na artiklima automatski postaju filteri na sajtu." />
    <Card><h2 className="mb-3 font-medium">Nova celina</h2><AttributeForm /></Card>
    {sections.map((section) => <Card key={section.id}>
      <AttributeForm id={section.id} name={section.name} order={section.order} active={section.active} />
      <div className="mt-4 space-y-4 border-t pt-4">
        {section.options.map((option) => <div key={option.id}>
          <AttributeForm id={option.id} sectionId={section.id} name={option.value} order={option.order} active={option.active} />
          <p className="mt-1 text-xs text-ink-500">{option._count.assignments} artikala</p>
        </div>)}
        <AttributeForm sectionId={section.id} />
      </div>
    </Card>)}
  </div>;
}
