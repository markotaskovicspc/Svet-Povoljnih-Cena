import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdminAction, withAdmin, withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { DataTable } from "@/components/admin/data-table";
import { Field } from "@/components/admin/field";
import { AdminActionForm } from "@/components/admin/action-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/admin/submit-button";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sadržaj",
  robots: { index: false, follow: false },
};

const contentPageSchema = z.object({
  id: z.string().optional().nullable(),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug mora biti mala slova, brojevi i crtice."),
  title: z.string().trim().min(1).max(160),
  lead: z.string().trim().max(1000).optional().nullable(),
  bodyMarkdown: z.string().trim().min(1).max(60000),
  seoTitle: z.string().trim().max(160).optional().nullable(),
  seoDescription: z.string().trim().max(500).optional().nullable(),
  published: z.coerce.boolean().default(true),
});

async function upsertContentPage(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT"], action: "content-page.upsert", entity: "ContentPage" },
    async (_actorId, formData: FormData) => {
      const parsed = contentPageSchema.safeParse({
        ...Object.fromEntries(formData.entries()),
        published: formData.get("published") === "on" || formData.get("published") === "true",
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Neispravan unos.",
        };
      }
      const data = parsed.data;
      const payload = {
        slug: data.slug,
        title: data.title,
        lead: data.lead || null,
        bodyMarkdown: data.bodyMarkdown,
        seoTitle: data.seoTitle || null,
        seoDescription: data.seoDescription || null,
        published: data.published,
      };
      const saved = data.id
        ? await db.contentPage.update({ where: { id: data.id }, data: payload })
        : await db.contentPage.upsert({
            where: { slug: data.slug },
            update: payload,
            create: payload,
          });
      revalidatePath("/admin/sadrzaj");
      revalidatePath(`/${saved.slug}`);
      return { ok: true as const, entityId: saved.id, diff: payload };
    },
  )(formData);
}

async function deleteContentPage(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "content-page.delete", entity: "ContentPage" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      if (!id) return { ok: false as const, error: "Nedostaje ID." };
      const page = await db.contentPage.delete({
        where: { id },
        select: { id: true, slug: true },
      });
      revalidatePath("/admin/sadrzaj");
      revalidatePath(`/${page.slug}`);
      return { ok: true as const, entityId: page.id };
    },
  )(formData);
}

export default async function ContentAdminPage() {
  await requireAdminAction(["CONTENT"]);
  const pages = await db.contentPage.findMany({
    orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
  });

  return (
    <>
      <PageHeader
        title="Sadržaj"
        description="CMS tekstovi za pravne i servisne stranice. Markdown paragrafi se prikazuju kao odvojene sekcije."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Sadržaj" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_460px]">
        <Card className="p-0">
          <DataTable
            columns={[
              { key: "title", label: "Naslov" },
              { key: "slug", label: "Slug" },
              { key: "updated", label: "Izmenjeno" },
              { key: "published", label: "Objavljeno", align: "center" },
              { key: "actions", label: "", align: "right" },
            ]}
            rows={pages.map((page) => ({
              id: page.id,
              cells: {
                title: (
                  <div>
                    <p className="font-medium text-ink-900">{page.title}</p>
                    {page.lead ? <p className="text-xs text-ink-500">{page.lead}</p> : null}
                  </div>
                ),
                slug: <span className="font-mono text-xs">/{page.slug}</span>,
                updated: page.updatedAt.toLocaleString("sr-Latn-RS", {
                  dateStyle: "short",
                  timeStyle: "short",
                }),
                published: page.published ? "Da" : "Ne",
                actions: (
                  <div className="flex justify-end gap-2">
                    <a href={`#edit-${page.id}`} className="text-xs text-walnut hover:underline">
                      Izmeni
                    </a>
                    <form action={deleteContentPage}>
                      <input type="hidden" name="id" value={page.id} />
                      <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                        Obriši
                      </SubmitButton>
                    </form>
                  </div>
                ),
              },
            }))}
            empty="Nema CMS stranica."
          />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle description="Za uslove kupovine koristite slug uslovi-kupovine.">
              Nova stranica
            </CardTitle>
            <ContentPageForm action={upsertContentPage} />
          </Card>

          {pages.map((page) => (
            <Card key={page.id} id={`edit-${page.id}`} className="scroll-mt-24">
              <CardTitle>Izmena: {page.title}</CardTitle>
              <ContentPageForm action={upsertContentPage} values={page} />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

type ContentPageFormValues = {
  id?: string;
  slug?: string;
  title?: string;
  lead?: string | null;
  bodyMarkdown?: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  published?: boolean;
};

function ContentPageForm({
  action,
  values,
}: {
  action: (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  values?: ContentPageFormValues;
}) {
  return (
    <AdminActionForm action={action} className="space-y-3">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Slug">
        <Input name="slug" required defaultValue={values?.slug ?? ""} placeholder="uslovi-kupovine" />
      </Field>
      <Field label="Naslov">
        <Input name="title" required defaultValue={values?.title ?? ""} />
      </Field>
      <Field label="Lead tekst">
        <Textarea name="lead" rows={3} defaultValue={values?.lead ?? ""} />
      </Field>
      <Field label="Tekst stranice">
        <Textarea
          name="bodyMarkdown"
          rows={12}
          required
          defaultValue={values?.bodyMarkdown ?? ""}
          placeholder={"## Sekcija\nTekst paragrafa.\n\n## Sledeća sekcija\n- Stavka"}
        />
      </Field>
      <Field label="SEO naslov">
        <Input name="seoTitle" defaultValue={values?.seoTitle ?? ""} />
      </Field>
      <Field label="SEO opis">
        <Textarea name="seoDescription" rows={2} defaultValue={values?.seoDescription ?? ""} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="published"
          defaultChecked={values?.published ?? true}
          className="size-4 accent-walnut"
        />
        Objavljeno
      </label>
      <SubmitButton>Sačuvaj stranicu</SubmitButton>
    </AdminActionForm>
  );
}
