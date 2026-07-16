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
  isPermanent: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).default(0),
  productIds: z.array(z.string()).default([]),
});

async function upsert(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "action.upsert", entity: "Action" },
    async (_a, formData: FormData) => {
        const parsed = schema.safeParse({
          ...Object.fromEntries(formData),
          productIds: formData.getAll("productIds").map(String),
          isHero: formData.get("isHero") === "on" || formData.get("isHero") === "true",
          isPermanent:
            formData.get("isPermanent") === "on" ||
            formData.get("isPermanent") === "true",
        });
        if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        const { id, productIds, ...rest } = parsed.data;
        const slug = rest.slug?.trim() || slugify(rest.name);

        const products = productIds.length
          ? await db.product.findMany({
              where: { id: { in: productIds }, deletedAt: null },
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
          isPermanent: rest.isPermanent,
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
  )(formData);
}

async function remove(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "action.delete", entity: "Action" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.action.delete({ where: { id } });
        revalidatePath("/admin/akcije");
        revalidatePath("/akcija");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

const dt = (d?: Date | null) => {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  await requireAdminAction(["CONTENT"]);
  const params = await searchParams;
  const [actions, products] = await Promise.all([
    db.action.findMany({
      orderBy: [{ sortOrder: "asc" }, { startsAt: "desc" }],
      include: { _count: { select: { products: true } }, products: { select: { id: true, sku: true } } },
    }),
    db.product.findMany({
      where: { deletedAt: null },
      orderBy: { sku: "asc" },
      select: { id: true, sku: true, name: true, stock: true, fullPrice: true },
    }),
  ]);
  const selected = params.new === "1"
    ? undefined
    : actions.find((action) => action.id === params.edit) ?? actions[0];

  return (
    <>
      <PageHeader
        title="Akcije"
        description="Akcijske kampanje, nedeljne akcije, heroji meseca i ograničena izdanja."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Akcije" }]}
      />
      <div className="grid grid-cols-1 items-start gap-6 px-8 py-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(560px,1.1fr)]">
        <Card className="max-h-[calc(100vh-11rem)] overflow-y-auto p-0">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-white px-4 py-3">
            <div>
              <p className="font-display text-lg font-semibold text-ink-900">Lista akcija</p>
              <p className="text-xs text-ink-500">Izaberite akciju da biste videli njene artikle.</p>
            </div>
            <a href="/admin/akcije?new=1" className="rounded-lg bg-walnut px-3 py-1.5 text-xs font-semibold text-white hover:bg-walnut/90">Nova akcija</a>
          </div>
          <DataTable
            columns={[
              { key: "name", label: "Naziv" },
              { key: "products", label: "Proizvoda", align: "right" },
              { key: "actions", label: "" },
            ]}
            rows={actions.map((a) => ({
              id: a.id,
              cells: {
                name: (
                  <div>
                    <p className="font-medium">{a.name}</p>
                    <p className="text-xs text-ink-500">
                      {a.kind} · {a.startsAt.toLocaleDateString("sr-Latn-RS")} → {a.endsAt.toLocaleDateString("sr-Latn-RS")}
                    </p>
                  </div>
                ),
                products: a._count.products,
                actions: (
                  <div className="flex justify-end gap-2">
                    <a href={`/admin/akcije?edit=${a.id}`} className="text-xs text-walnut hover:underline">
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
        <Card className="xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
          <CardTitle>{selected ? `Izmena: ${selected.name}` : "Nova akcija"}</CardTitle>
          <ActionForm
            key={selected?.id ?? "new"}
            action={upsert}
            products={products.map((product) => ({ ...product, fullPrice: Number(product.fullPrice) }))}
            values={selected ? {
              ...selected,
              startsAt: dt(selected.startsAt),
              endsAt: dt(selected.endsAt),
              productIds: selected.products.map((product) => product.id),
            } : undefined}
          />
        </Card>
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
  isPermanent?: boolean;
  sortOrder?: number;
  productIds?: string[];
};

function ActionForm({
  action,
  values,
  products,
}: {
  action: (fd: FormData) => Promise<void>;
  values?: V;
  products: { id: string; sku: string; name: string; stock: number; fullPrice: number }[];
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
        <Field label="Oznake">
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="isHero"
                defaultChecked={values?.isHero ?? false}
                className="size-4 accent-walnut"
              />
              Označi kao glavnu akciju
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="isPermanent"
                defaultChecked={values?.isPermanent ?? false}
                className="size-4 accent-walnut"
              />
              Trajno niska cena
            </label>
          </div>
        </Field>
      </div>
      <Field label={`Artikli (${values?.productIds?.length ?? 0} izabrano)`} hint="Izaberite proizvode koji pripadaju ovoj akciji.">
        <div className="max-h-72 overflow-y-auto rounded-lg border border-input">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted-bg text-ink-500">
              <tr><th className="w-10 px-2 py-2">✓</th><th className="px-2 py-2">SKU</th><th className="px-2 py-2">Naziv</th><th className="px-2 py-2 text-right">Zaliha</th><th className="px-2 py-2 text-right">MPC</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((product) => (
                <tr key={product.id} className="hover:bg-muted-bg/50">
                  <td className="px-2 py-1.5"><input type="checkbox" name="productIds" value={product.id} defaultChecked={values?.productIds?.includes(product.id) ?? false} className="size-4 accent-walnut" /></td>
                  <td className="px-2 py-1.5 font-mono">{product.sku}</td>
                  <td className="max-w-52 truncate px-2 py-1.5">{product.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{product.stock}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{product.fullPrice.toLocaleString("sr-Latn-RS")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj akciju"}</SubmitButton>
      </div>
    </form>
  );
}
