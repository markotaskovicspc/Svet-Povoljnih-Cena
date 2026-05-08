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
  title: "Promo traka",
  robots: { index: false, follow: false },
};

const schema = z.object({
  id: z.string().optional().nullable(),
  text: z.string().min(1).max(180),
  href: z.string().max(500).optional().nullable(),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  enabled: z.coerce.boolean().default(true),
});

const upsert = withAdmin(
  { allowed: ["CONTENT"], action: "promobar.upsert", entity: "PromoBar" },
  async (_a, formData: FormData) => {
    const parsed = schema.safeParse({
      ...Object.fromEntries(formData),
      enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
    });
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
    const { id, ...payload } = parsed.data;
    const data = {
      text: payload.text,
      href: payload.href || null,
      startsAt: payload.startsAt ? new Date(payload.startsAt) : null,
      endsAt: payload.endsAt ? new Date(payload.endsAt) : null,
      enabled: payload.enabled,
    };
    const saved = id
      ? await db.promoBar.update({ where: { id }, data })
      : await db.promoBar.create({ data });
    revalidatePath("/admin/promo-traka");
    revalidatePath("/");
    return { ok: true as const, entityId: saved.id, diff: data };
  },
);

const remove = withAdmin(
  { allowed: ["CONTENT"], action: "promobar.delete", entity: "PromoBar" },
  async (_a, formData: FormData) => {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false as const, error: "Nedostaje ID." };
    await db.promoBar.delete({ where: { id } });
    revalidatePath("/admin/promo-traka");
    revalidatePath("/");
    return { ok: true as const, entityId: id };
  },
);

const dt = (d?: Date | null) => {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default async function PromoBarPage() {
  await requireAdminAction(["CONTENT"]);
  const bars = await db.promoBar.findMany({ orderBy: { updatedAt: "desc" } });

  return (
    <>
      <PageHeader
        title="Promo traka"
        description="Najavna traka iznad headera. Više stavki rotira frontend; ostavite jednu aktivnu za stalnu poruku."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Promo traka" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Nova poruka</CardTitle>
          <Form action={upsert} />
        </Card>
        <div className="space-y-6">
          {bars.map((b) => (
            <Card key={b.id}>
              <CardTitle description={b.enabled ? "Aktivno" : "Neaktivno"}>
                {b.text.slice(0, 60)}
              </CardTitle>
              <Form
                action={upsert}
                values={{ ...b, startsAt: dt(b.startsAt), endsAt: dt(b.endsAt) }}
              />
              <form action={remove} className="mt-4 flex justify-end">
                <input type="hidden" name="id" value={b.id} />
                <SubmitButton variant="destructive" size="sm" pendingLabel="…">
                  Obriši
                </SubmitButton>
              </form>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

type V = {
  id?: string;
  text?: string;
  href?: string | null;
  startsAt?: string;
  endsAt?: string;
  enabled?: boolean;
};

function Form({
  action,
  values,
}: {
  action: (fd: FormData) => Promise<void>;
  values?: V;
}) {
  return (
    <form action={action} className="space-y-3">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Tekst">
        <Textarea name="text" required rows={2} defaultValue={values?.text ?? ""} />
      </Field>
      <Field label="Link (opciono)">
        <Input name="href" defaultValue={values?.href ?? ""} placeholder="/akcija" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Počinje">
          <Input name="startsAt" type="datetime-local" defaultValue={values?.startsAt ?? ""} />
        </Field>
        <Field label="Završava">
          <Input name="endsAt" type="datetime-local" defaultValue={values?.endsAt ?? ""} />
        </Field>
      </div>
      <Field label="Aktivno">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={values?.enabled ?? true}
            className="size-4 accent-walnut"
          />
          Prikaži posetiocima
        </label>
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj"}</SubmitButton>
      </div>
    </form>
  );
}
