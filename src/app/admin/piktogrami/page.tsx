import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import Image from "next/image";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Piktogrami",
  robots: { index: false, follow: false },
};

const schema = z.object({
  id: z.string().optional().nullable(),
  code: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/i),
  label: z.string().min(1).max(80),
  iconUrl: z.string().url().max(500),
});

async function upsert(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "pictogram.upsert", entity: "Pictogram" },
    async (_a, formData: FormData) => {
        const parsed = schema.safeParse(Object.fromEntries(formData));
        if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        const { id, ...data } = parsed.data;
        const saved = id
          ? await db.pictogram.update({ where: { id }, data })
          : await db.pictogram.create({ data });
        revalidatePath("/admin/piktogrami");
        return { ok: true as const, entityId: saved.id, diff: data };
      },
  )(formData);
}

async function remove(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "pictogram.delete", entity: "Pictogram" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.pictogram.delete({ where: { id } });
        revalidatePath("/admin/piktogrami");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

export default async function PictogramsPage() {
  await requireAdminAction(["CONTENT"]);
  const items = await db.pictogram.findMany({ orderBy: { code: "asc" } });

  return (
    <>
      <PageHeader
        title="Piktogrami"
        description={'Bedževi koje proizvod može da nosi (npr. „brza isporuka", „uštedi 20%").'}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Piktogrami" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-[1fr_360px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.length === 0 ? (
            <p className="col-span-full text-sm text-ink-500">Nema piktograma.</p>
          ) : (
            items.map((p) => (
              <Card key={p.id} id={`edit-${p.id}`} className="scroll-mt-24 p-4">
                <div className="flex items-center gap-3">
                  <div className="relative size-10 overflow-hidden rounded-md bg-muted-bg">
                    {p.iconUrl ? (
                      <Image
                        src={p.iconUrl}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-contain"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.label}</p>
                    <p className="truncate font-mono text-[11px] text-ink-500">{p.code}</p>
                  </div>
                </div>
                <PictogramForm action={upsert} values={p} />
                <form action={remove} className="mt-2 flex justify-end">
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                    Obriši
                  </SubmitButton>
                </form>
              </Card>
            ))
          )}
        </div>
        <Card>
          <CardTitle>Novi piktogram</CardTitle>
          <PictogramForm action={upsert} />
        </Card>
      </div>
    </>
  );
}

function PictogramForm({
  action,
  values,
}: {
  action: (fd: FormData) => Promise<void>;
  values?: { id?: string; code?: string; label?: string; iconUrl?: string };
}) {
  return (
    <form action={action} className="mt-3 space-y-2">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Kod">
        <Input name="code" required defaultValue={values?.code ?? ""} />
      </Field>
      <Field label="Labela">
        <Input name="label" required defaultValue={values?.label ?? ""} />
      </Field>
      <Field label="Ikona (URL)">
        <Input name="iconUrl" type="url" required defaultValue={values?.iconUrl ?? ""} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton size="sm">{values?.id ? "Sačuvaj" : "Dodaj"}</SubmitButton>
      </div>
    </form>
  );
}
