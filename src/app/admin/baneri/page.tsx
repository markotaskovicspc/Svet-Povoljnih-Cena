import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BannerPlacement } from "@prisma/client";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "@/components/admin/submit-button";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/admin/data-table";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Baneri",
  robots: { index: false, follow: false },
};

const assetPathSchema = z
  .string()
  .max(500)
  .refine(
    (value) => value.startsWith("/") || z.string().url().safeParse(value).success,
    "Unesite pun URL ili putanju koja počinje sa /.",
  );

const upsertSchema = z.object({
  id: z.string().optional().nullable(),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(240).optional().nullable(),
  ctaLabel: z.string().max(40).optional().nullable(),
  ctaHref: z.string().max(500).optional().nullable(),
  imageDesktop: assetPathSchema,
  imageMobile: assetPathSchema.optional().nullable(),
  startsAt: z.string().optional().nullable(),
  endsAt: z.string().optional().nullable(),
  order: z.coerce.number().int().min(0).max(9999).default(0),
  enabled: z.coerce.boolean().default(true),
  placement: z.nativeEnum(BannerPlacement).default(BannerPlacement.HERO),
});

const bannerPlacementLabel: Record<BannerPlacement, string> = {
  HERO: "Glavni hero baner",
  HOME_AFTER_SECOND_ROW: "Početna: posle sekcije 2",
  HOME_AFTER_FOURTH_ROW: "Početna: posle sekcije 4",
};

async function upsertBanner(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT"], action: "banner.upsert", entity: "Banner" },
    async (_actorId, formData: FormData) => {
        const raw = Object.fromEntries(formData.entries());
        const parsed = upsertSchema.safeParse({
          ...raw,
          enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
        });
        if (!parsed.success) {
          return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Neispravan unos." };
        }
        const data = parsed.data;
        const payload = {
          title: data.title,
          subtitle: data.subtitle || null,
          ctaLabel: data.ctaLabel || null,
          ctaHref: data.ctaHref || null,
          imageDesktop: data.imageDesktop,
          imageMobile: data.imageMobile || null,
          startsAt: data.startsAt ? new Date(data.startsAt) : null,
          endsAt: data.endsAt ? new Date(data.endsAt) : null,
          order: data.order,
          enabled: data.enabled,
          placement: data.placement,
        };
        const saved = data.id
          ? await db.banner.update({ where: { id: data.id }, data: payload })
          : await db.banner.create({ data: payload });
        revalidatePath("/admin/baneri");
        revalidatePath("/");
        revalidatePath("/niske-cene-pod-zastitom");
        return { ok: true as const, entityId: saved.id, diff: payload };
      },
  )(formData);
}

async function deleteBanner(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "banner.delete", entity: "Banner" },
    async (_actorId, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        await db.banner.delete({ where: { id } });
        revalidatePath("/admin/baneri");
        revalidatePath("/");
        revalidatePath("/niske-cene-pod-zastitom");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

function dtLocal(value?: Date | null) {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export default async function BannersPage() {
  await requireAdminAction(["CONTENT"]);
  const banners = await db.banner.findMany({ orderBy: [{ order: "asc" }, { createdAt: "desc" }] });

  return (
    <>
      <PageHeader
        title="Baneri"
        description="Baneri za glavni carousel i dve pozicije između promo sekcija na početnoj. Niži broj redosleda = ranije se prikazuje."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Baneri" }]}
      />
      <div className="grid grid-cols-1 gap-6 px-8 py-6 xl:grid-cols-[1fr_440px]">
        <Card className="p-0">
          <DataTable
            columns={[
              { key: "title", label: "Naslov" },
              { key: "schedule", label: "Period" },
              { key: "placement", label: "Pozicija" },
              { key: "order", label: "Red.", align: "right" },
              { key: "enabled", label: "Aktivan", align: "center" },
              { key: "actions", label: "", align: "right" },
            ]}
            rows={banners.map((b) => ({
              id: b.id,
              cells: {
                title: (
                  <div>
                    <p className="font-medium text-ink-900">{b.title}</p>
                    {b.subtitle ? (
                      <p className="text-xs text-ink-500">{b.subtitle}</p>
                    ) : null}
                  </div>
                ),
                schedule:
                  b.startsAt || b.endsAt
                    ? `${b.startsAt ? new Intl.DateTimeFormat("sr-Latn-RS").format(b.startsAt) : "—"} → ${b.endsAt ? new Intl.DateTimeFormat("sr-Latn-RS").format(b.endsAt) : "—"}`
                    : "Stalno",
                placement: bannerPlacementLabel[b.placement],
                order: b.order,
                enabled: b.enabled ? "✓" : "—",
                actions: (
                  <div className="flex justify-end gap-2">
                    <a
                      href={`#edit-${b.id}`}
                      className="text-xs text-walnut hover:underline"
                    >
                      Izmeni
                    </a>
                    <form action={deleteBanner}>
                      <input type="hidden" name="id" value={b.id} />
                      <SubmitButton
                        variant="destructive"
                        size="xs"
                        pendingLabel="…"
                      >
                        Obriši
                      </SubmitButton>
                    </form>
                  </div>
                ),
              },
            }))}
            empty="Još nema banera. Dodajte prvi sa desne strane."
          />
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle description="Novi baner se odmah prikazuje ako je aktivan i u periodu prikaza.">
              Novi baner
            </CardTitle>
            <BannerForm action={upsertBanner} />
          </Card>

          {banners.map((b) => (
            <Card key={b.id} className="scroll-mt-24" id={`edit-${b.id}`}>
              <CardTitle>Izmena: {b.title}</CardTitle>
              <BannerForm
                action={upsertBanner}
                values={{
                  ...b,
                  startsAt: dtLocal(b.startsAt),
                  endsAt: dtLocal(b.endsAt),
                }}
              />
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

type BannerFormValues = {
  id?: string;
  title?: string;
  subtitle?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  imageDesktop?: string;
  imageMobile?: string | null;
  startsAt?: string;
  endsAt?: string;
  order?: number;
  enabled?: boolean;
  placement?: BannerPlacement;
};

function BannerForm({
  action,
  values,
}: {
  action: (
    state: AdminActionState,
    formData: FormData,
  ) => Promise<AdminActionState>;
  values?: BannerFormValues;
}) {
  return (
    <AdminActionForm action={action} className="space-y-4">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Naslov">
        <Input name="title" required defaultValue={values?.title ?? ""} />
      </Field>
      <Field label="Podnaslov">
        <Textarea
          name="subtitle"
          rows={2}
          defaultValue={values?.subtitle ?? ""}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CTA labela">
          <Input name="ctaLabel" defaultValue={values?.ctaLabel ?? ""} />
        </Field>
        <Field label="CTA link">
          <Input
            name="ctaHref"
            defaultValue={values?.ctaHref ?? ""}
            placeholder="/akcija"
          />
        </Field>
      </div>
      <Field label="Slika (desktop URL)">
        <Input
          name="imageDesktop"
          type="text"
          required
          defaultValue={values?.imageDesktop ?? ""}
        />
      </Field>
      <Field label="Slika (mobilna URL)">
        <Input
          name="imageMobile"
          type="text"
          defaultValue={values?.imageMobile ?? ""}
        />
      </Field>
      <Field label="Pozicija">
        <select
          name="placement"
          defaultValue={values?.placement ?? BannerPlacement.HERO}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {Object.values(BannerPlacement).map((placement) => (
            <option key={placement} value={placement}>
              {bannerPlacementLabel[placement]}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Počinje">
          <Input
            name="startsAt"
            type="datetime-local"
            defaultValue={values?.startsAt ?? ""}
          />
        </Field>
        <Field label="Završava">
          <Input
            name="endsAt"
            type="datetime-local"
            defaultValue={values?.endsAt ?? ""}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Redosled">
          <Input
            name="order"
            type="number"
            min={0}
            defaultValue={values?.order ?? 0}
          />
        </Field>
        <Field label="Aktivan">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={values?.enabled ?? true}
              className="size-4 accent-walnut"
            />
            Prikazuj na sajtu
          </label>
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        {values?.id ? (
          <Button type="reset" variant="outline" size="sm">
            Resetuj
          </Button>
        ) : null}
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj baner"}</SubmitButton>
      </div>
    </AdminActionForm>
  );
}
