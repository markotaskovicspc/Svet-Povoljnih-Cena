import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withAdmin, requireAdminAction } from "@/lib/admin";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { SubmitButton } from "@/components/admin/submit-button";
import { Input } from "@/components/ui/input";
import { RecommendationScopeFields } from "@/components/admin/recommendation-scope-fields";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Preporuke kupovine",
  robots: { index: false, follow: false },
};

const schema = z
  .object({
    id: z.string().optional().nullable(),
    scope: z.enum(["GROUP", "PRODUCT"]),
    groupId: z.string().trim().default(""),
    sourceProductSku: z.string().trim().default(""),
    productSkus: z.string().trim().min(1, "Unesite bar jedan preporučeni SKU."),
    order: z.coerce.number().int().min(0).default(0),
    enabled: z.coerce.boolean().default(true),
  })
  .superRefine((value, context) => {
    if (value.scope === "GROUP" && !value.groupId) {
      context.addIssue({
        code: "custom",
        path: ["groupId"],
        message: "Izaberite grupu za grupno pravilo.",
      });
    }
    if (value.scope === "PRODUCT" && !value.sourceProductSku) {
      context.addIssue({
        code: "custom",
        path: ["sourceProductSku"],
        message: "Unesite SKU artikla koji pokreće preporuku.",
      });
    }
  });

function parseSkus(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((sku) => sku.trim())
        .filter(Boolean),
    ),
  );
}

async function upsert(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "rec.upsert", entity: "RecommendationRule" },
    async (_a, formData: FormData) => {
        const parsed = schema.safeParse({
          ...Object.fromEntries(formData),
          enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
        });
        if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        const skus = parseSkus(parsed.data.productSkus);
        const [products, sourceProduct] = await Promise.all([
          db.product.findMany({
            where: { sku: { in: skus }, deletedAt: null },
            select: { id: true, sku: true },
          }),
          parsed.data.scope === "PRODUCT"
            ? db.product.findFirst({
                where: {
                  sku: parsed.data.sourceProductSku,
                  deletedAt: null,
                },
                select: { id: true, sku: true },
              })
            : null,
        ]);
        const foundSkus = new Set(products.map((product) => product.sku));
        const missingSkus = skus.filter((sku) => !foundSkus.has(sku));
        if (missingSkus.length) {
          return {
            ok: false as const,
            error: `Preporučeni artikli ne postoje: ${missingSkus.join(", ")}.`,
          };
        }
        if (parsed.data.scope === "PRODUCT" && !sourceProduct) {
          return {
            ok: false as const,
            error: `Izvorni artikal ${parsed.data.sourceProductSku} ne postoji.`,
          };
        }
        if (sourceProduct && foundSkus.has(sourceProduct.sku)) {
          return {
            ok: false as const,
            error: "Artikal ne može sam sebi da bude preporuka.",
          };
        }

        const data = {
          groupId: parsed.data.scope === "GROUP" ? parsed.data.groupId : null,
          sourceProductId:
            parsed.data.scope === "PRODUCT" ? sourceProduct!.id : null,
          order: parsed.data.order,
          enabled: parsed.data.enabled,
          products: { set: products.map((p) => ({ id: p.id })) },
        };

        const saved = parsed.data.id
          ? await db.recommendationRule.update({ where: { id: parsed.data.id }, data })
          : await db.recommendationRule.create({
              data: {
                groupId: data.groupId,
                sourceProductId: data.sourceProductId,
                order: parsed.data.order,
                enabled: parsed.data.enabled,
                products: { connect: products.map((p) => ({ id: p.id })) },
              },
            });
        revalidatePath("/admin/preporuke");
        return {
          ok: true as const,
          entityId: saved.id,
          diff: {
            scope: parsed.data.scope,
            groupId: data.groupId,
            sourceProductId: data.sourceProductId,
            count: products.length,
          },
        };
      },
  )(formData);
}

async function remove(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "rec.delete", entity: "RecommendationRule" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.recommendationRule.delete({ where: { id } });
        revalidatePath("/admin/preporuke");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

export default async function RecsPage() {
  await requireAdminAction(["CONTENT"]);
  const [rules, groups] = await Promise.all([
    db.recommendationRule.findMany({
      orderBy: [{ order: "asc" }],
      include: {
        group: { select: { name: true, slug: true } },
        sourceProduct: { select: { sku: true, name: true } },
        products: { select: { sku: true, name: true } },
      },
    }),
    db.group.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Preporuke kupovine"
        description={'Cross-sell modal („predlog kupovine") koji se prikazuje odmah nakon dodavanja artikla u korpu. Pravilo može važiti za celu grupu ili samo za jedan konkretan artikal.'}
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Preporuke" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          {rules.length === 0 ? (
            <Card>
              <p className="text-sm text-ink-500">Nema definisanih pravila.</p>
            </Card>
          ) : (
            rules.map((r) => (
              <Card key={r.id} id={`edit-${r.id}`} className="scroll-mt-24">
                <CardTitle
                  description={`${
                    r.sourceProduct
                      ? `Artikal: ${r.sourceProduct.sku} · ${r.sourceProduct.name}`
                      : `Grupa: ${r.group?.name ?? "—"}`
                  } · ${r.enabled ? "Aktivno" : "Neaktivno"}`}
                >
                  Pravilo #{r.order}
                </CardTitle>
                <ul className="mb-3 flex flex-wrap gap-1 text-xs">
                  {r.products.map((p) => (
                    <li key={p.sku} className="rounded bg-muted-bg px-2 py-0.5 font-mono">
                      {p.sku}
                    </li>
                  ))}
                </ul>
                <RuleForm
                  action={upsert}
                  groups={groups}
                  values={{
                    id: r.id,
                    scope: r.sourceProductId ? "PRODUCT" : "GROUP",
                    groupId: r.groupId ?? "",
                    sourceProductSku: r.sourceProduct?.sku ?? "",
                    order: r.order,
                    enabled: r.enabled,
                    productSkus: r.products.map((p) => p.sku).join(", "),
                  }}
                />
                <form action={remove} className="mt-2 flex justify-end">
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton variant="destructive" size="sm" pendingLabel="…">
                    Obriši pravilo
                  </SubmitButton>
                </form>
              </Card>
            ))
          )}
        </div>
        <Card>
          <CardTitle>Novo pravilo</CardTitle>
          <RuleForm action={upsert} groups={groups} />
        </Card>
      </div>
    </>
  );
}

function RuleForm({
  action,
  groups,
  values,
}: {
  action: (fd: FormData) => Promise<void>;
  groups: { id: string; name: string }[];
  values?: {
    id?: string;
    scope?: "GROUP" | "PRODUCT";
    groupId?: string;
    sourceProductSku?: string;
    order?: number;
    enabled?: boolean;
    productSkus?: string;
  };
}) {
  return (
    <form action={action} className="space-y-3">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <RecommendationScopeFields
        groups={groups}
        initialScope={values?.scope}
        initialGroupId={values?.groupId}
        initialSourceProductSku={values?.sourceProductSku}
      />
      <Field
        label="Preporučeni SKU-ovi"
        hint="Artikli koji će iskočiti kupcu; razdvojite ih zarezima ili razmacima."
      >
        <textarea
          name="productSkus"
          rows={3}
          required
          defaultValue={values?.productSkus ?? ""}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Redosled">
          <Input name="order" type="number" min={0} defaultValue={values?.order ?? 0} />
        </Field>
        <Field label="Aktivno">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={values?.enabled ?? true}
              className="size-4 accent-walnut"
            />
            Prikazuj kupcima
          </label>
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj"}</SubmitButton>
      </div>
    </form>
  );
}
