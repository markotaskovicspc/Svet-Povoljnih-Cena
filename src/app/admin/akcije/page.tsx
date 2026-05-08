import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionKind } from "@prisma/client";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Akcije",
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
  name: z.string().min(1).max(120),
  slug: z.string().max(120).optional(),
  kind: z.nativeEnum(ActionKind).default("CUSTOM"),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  isHero: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
  productSkus: z.string().optional(),
});

const upsert = withAdmin(
  { allowed: ["CONTENT"], action: "action.upsert", entity: "Action" },
  async (_a, formData: FormData) => {
    const parsed = schema.safeParse({
      ...Object.fromEntries(formData),
      isHero: formData.get("isHero") === "on" || formData.get("isHero") === "true",
    });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
    const { id, productSkus, ...rest } = parsed.data;
    const slug = rest.slug?.trim() || slugify(rest.name);

    const skus = (productSkus ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const products = skus.length
      ? await db.product.findMany({
          where: { sku: { in: skus } },
          select: { id: true },
        })
      : [];

    const data = {
      slug,
      name: rest.name,
      kind: rest.kind,
      startsAt: new Date(rest.startsAt),
      endsAt: new Date(rest.endsAt),
      isHero: rest.isHero,
      sortOrder: rest.sortOrder,
    };

    const saved = id
      ? await db.action.update({
          where: { id },
          data: {
            ...data,
            products: { set: products.map((p) => ({ id: p.id })) },
          },
        })
      : await db.action.create({
          data: {
            ...data,
            products: { connect: products.map((p) => ({ id: p.id })) },
          },
        });
    revalidatePath("/admin/akcije");
    revalidatePath("/akcija");
    return { ok: true as const, entityId: saved.id, diff: { ...data, productCount: products.length } };
  },
);

const remove = withAdmin(
  { allowed: ["CONTENT"], action: "action.delete", entity: "Action" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false as const, error: "Nedostaje ID." };
    await db.action.delete({ where: { id } });
    revalidatePath("/admin/akcije");
    revalidatePath("/akcija");
    return { ok: true as const, entityId: id };
  },
);

const dt = (d?: Date | null) => {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default async function ActionsPage() {
  await requireAdminAction(["CONTENT"]);
  const actions = await db.action.findMany({
    orderBy: [{ sortOrder: "asc" }, { startsAt: "desc" }],
    include: { _count: { select: { products: true } }, products: { select: { sku: true } } },
  });

  return (
    <>
      <PageHeader
        title="Akcije"
        description="Akcijske kampanje, nedeljne akcije, heroji meseca i ograničena izdanja."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Akcije" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_440px]">
        <Card className="p-0">
          <DataTable
            columns={[
              { key: "name", label: "Naziv" },
              { key: "kind", label: "Tip" },
              { key: "period", label: "Period" },
              { key: "products", label: "Proizvoda", align: "right" },
              { key: "actions", label: "" },
            ]}
            rows={actions.map((a) => ({
              id: a.id,
              cells: {
                name: (
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="font-mono text-xs text-ink-500">/{a.slug}</p>
                  </div>
                ),
                kind: a.kind,
                period: `${a.startsAt.toLocaleDateString("sr-Latn-RS")} → ${a.endsAt.toLocaleDateString("sr-Latn-RS")}`,
                products: a._count.products,
                actions: (
                  <div className="flex justify-end gap-2">
                    <a href={`#edit-${a.id}`} className="text-xs text-walnut hover:underline">
                      Izmeni
                    </a>
                    <form action={remove}>
                      <input type="hidden" name="id" value={a.id} />
                      <SubmitButton variant="destructive" size="xs" pendingLabel="…">
                        Obriši
                      </SubmitButton>
                    </form>
                  </div>
                ),
              },
            }))}
            empty="Nema akcija."
          />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardTitle>Nova akcija</CardTitle>
            <ActionForm action={upsert} />
          </Card>
          {actions.map((a) => (
            <Card key={a.id} id={`edit-${a.id}`} className="scroll-mt-24">
              <CardTitle>Izmena: {a.name}</CardTitle>
              <ActionForm
                action={upsert}
                values={{
                  ...a,
                  startsAt: dt(a.startsAt),
                  endsAt: dt(a.endsAt),
                  productSkus: a.products.map((p) => p.sku).join(", "),
                }}
              />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

type V = {
  id?: string;
  name?: string;
  slug?: string;
  kind?: ActionKind;
  startsAt?: string;
  endsAt?: string;
  isHero?: boolean;
  sortOrder?: number;
  productSkus?: string;
};

function ActionForm({
  action,
  values,
}: {
  action: (fd: FormData) => Promise<void>;
  values?: V;
}) {
  return (
    <form action={action} className="space-y-3">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Naziv">
        <Input name="name" required defaultValue={values?.name ?? ""} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Slug (opciono)">
          <Input name="slug" defaultValue={values?.slug ?? ""} />
        </Field>
        <Field label="Tip">
          <select
            name="kind"
            defaultValue={values?.kind ?? "CUSTOM"}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            {Object.values(ActionKind).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Počinje">
          <Input
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={values?.startsAt ?? ""}
          />
        </Field>
        <Field label="Završava">
          <Input
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={values?.endsAt ?? ""}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Redosled">
          <Input
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={values?.sortOrder ?? 0}
          />
        </Field>
        <Field label="Hero">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isHero"
              defaultChecked={values?.isHero ?? false}
              className="size-4 accent-walnut"
            />
            Označi kao glavnu akciju
          </label>
        </Field>
      </div>
      <Field
        label="SKU lista"
        hint="Razdvojite zarezima ili razmacima. Nepoznati SKU-ovi se preskaču."
      >
        <textarea
          name="productSkus"
          rows={3}
          defaultValue={values?.productSkus ?? ""}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
        />
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj akciju"}</SubmitButton>
      </div>
    </form>
  );
}
