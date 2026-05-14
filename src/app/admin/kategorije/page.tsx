import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Kategorije",
  robots: { index: false, follow: false },
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "dj")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const schema = z.object({
  id: z.string().optional().nullable(),
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80).optional(),
  parentId: z.string().optional().nullable(),
  order: z.coerce.number().int().min(0).default(0),
  imageUrl: z.string().url().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
});

async function upsert(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "category.upsert", entity: "Category" },
    async (_a, formData: FormData) => {
        const parsed = schema.safeParse(Object.fromEntries(formData));
        if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        const data = parsed.data;
        const slug = data.slug?.trim() || slugify(data.name);
        const parent = data.parentId
          ? await db.category.findUnique({ where: { id: data.parentId } })
          : null;
        const level = parent ? parent.level + 1 : 0;
        const path = parent ? `${parent.path}/${slug}` : `/${slug}`;

        const payload = {
          name: data.name,
          slug,
          parentId: parent?.id ?? null,
          order: data.order,
          imageUrl: data.imageUrl || null,
          description: data.description || null,
          level,
          path,
        };
        const saved = data.id
          ? await db.category.update({ where: { id: data.id }, data: payload })
          : await db.category.create({ data: payload });
        revalidatePath("/admin/kategorije");
        revalidatePath("/");
        return { ok: true as const, entityId: saved.id, diff: payload };
      },
  )(formData);
}

async function remove(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "category.delete", entity: "Category" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        const childCount = await db.category.count({ where: { parentId: id } });
        if (childCount > 0) {
          return { ok: false as const, error: "Premestite ili obrišite podkategorije pre brisanja." };
        }
        await db.category.delete({ where: { id } });
        revalidatePath("/admin/kategorije");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

export default async function CategoriesPage() {
  await requireAdminAction(["CONTENT"]);
  const cats = await db.category.findMany({
    orderBy: [{ path: "asc" }],
  });
  const flat = cats.map((c) => ({
    ...c,
    indent: c.level,
  }));

  return (
    <>
      <PageHeader
        title="Kategorije"
        description="Hijerarhijska struktura kategorija. Putanja se izračunava iz slug-a roditelja."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Kategorije" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_400px]">
        <Card>
          <CardTitle description="Klikom na ime otvarate izmenu.">Stablo</CardTitle>
          {flat.length === 0 ? (
            <p className="text-sm text-ink-500">Još nema kategorija.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {flat.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-muted-bg/50"
                  style={{ paddingLeft: `${c.indent * 16 + 8}px` }}
                >
                  <a href={`#edit-${c.id}`} className="text-ink-900 hover:text-walnut">
                    {c.name}{" "}
                    <span className="ml-1 font-mono text-[11px] text-ink-300">{c.path}</span>
                  </a>
                  <form action={remove}>
                    <input type="hidden" name="id" value={c.id} />
                    <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                      ×
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardTitle>Nova kategorija</CardTitle>
            <CategoryForm action={upsert} parents={cats} />
          </Card>
          {cats.map((c) => (
            <Card key={c.id} id={`edit-${c.id}`} className="scroll-mt-24">
              <CardTitle>Izmena: {c.name}</CardTitle>
              <CategoryForm action={upsert} parents={cats} values={c} />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

function CategoryForm({
  action,
  parents,
  values,
}: {
  action: (fd: FormData) => Promise<void>;
  parents: { id: string; name: string; path: string; level: number }[];
  values?: {
    id?: string;
    name?: string;
    slug?: string;
    parentId?: string | null;
    order?: number;
    imageUrl?: string | null;
    description?: string | null;
  };
}) {
  return (
    <form action={action} className="space-y-3">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Naziv">
        <Input name="name" required defaultValue={values?.name ?? ""} />
      </Field>
      <Field label="Slug (opciono)" hint="Ostaviti prazno = automatski iz naziva">
        <Input name="slug" defaultValue={values?.slug ?? ""} />
      </Field>
      <Field label="Roditelj">
        <select
          name="parentId"
          defaultValue={values?.parentId ?? ""}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— Top-level —</option>
          {parents
            .filter((p) => p.id !== values?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {"— ".repeat(p.level)}
                {p.name}
              </option>
            ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Redosled">
          <Input name="order" type="number" min={0} defaultValue={values?.order ?? 0} />
        </Field>
        <Field label="Slika (URL)">
          <Input name="imageUrl" type="url" defaultValue={values?.imageUrl ?? ""} />
        </Field>
      </div>
      <Field label="Opis">
        <Textarea name="description" rows={3} defaultValue={values?.description ?? ""} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj"}</SubmitButton>
      </div>
    </form>
  );
}
