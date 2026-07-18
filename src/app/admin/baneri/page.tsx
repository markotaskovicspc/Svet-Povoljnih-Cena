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
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit";
import { Button } from "@/components/ui/button";

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

type SectionKind = "carousel" | "single";

type SectionDef = {
  placement: BannerPlacement;
  title: string;
  where: string;
  kind: SectionKind;
  /** Recommended upload dimensions, shown to the editor. */
  desktopSize: string;
  mobileSize?: string;
  hint: string;
};

/**
 * Three fixed homepage banner areas. The order of this array is the visual
 * order on the homepage (header → after row 2 → after row 4).
 */
const SECTIONS: SectionDef[] = [
  {
    placement: BannerPlacement.HERO,
    title: "1 · Glavni hero baner (carousel)",
    where: "Odmah ispod pretrage, na vrhu početne strane.",
    kind: "carousel",
    desktopSize: "1440 × 600 px (odnos 24:10)",
    mobileSize: "768 × 960 px",
    hint: "Ovo je jedini baner koji može da sadrži više slika — svaka dodata slika je jedan slajd carousel-a. Strelicama menjate redosled slajdova.",
  },
  {
    placement: BannerPlacement.HOME_AFTER_SECOND_ROW,
    title: "2 · Baner posle 2. reda",
    where: "Između druge i treće promo sekcije na početnoj (sada „Trajno niska cena“).",
    kind: "single",
    desktopSize: "1200 × 400 px",
    hint: "Jedna slika. Ako dodate više, prikazuje se prvi aktivni; ostale označite kao neaktivne ili obrišite.",
  },
  {
    placement: BannerPlacement.HOME_AFTER_FOURTH_ROW,
    title: "3 · Baner posle 4. reda",
    where: "Između četvrte i pete promo sekcije na početnoj (sada „Heroji meseca“).",
    kind: "single",
    desktopSize: "1200 × 400 px",
    hint: "Jedna slika. Ako dodate više, prikazuje se prvi aktivni; ostale označite kao neaktivne ili obrišite.",
  },
];

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
      const startsAt = data.startsAt ? new Date(data.startsAt) : null;
      const endsAt = data.endsAt ? new Date(data.endsAt) : null;
      if (
        (startsAt && Number.isNaN(startsAt.getTime())) ||
        (endsAt && Number.isNaN(endsAt.getTime())) ||
        (startsAt && endsAt && startsAt >= endsAt)
      ) {
        return {
          ok: false as const,
          error: "Period nije ispravan; kraj mora biti posle početka.",
        };
      }
      if (data.enabled && data.placement !== BannerPlacement.HERO) {
        const overlap = await db.banner.findFirst({
          where: {
            placement: data.placement,
            enabled: true,
            NOT: data.id ? { id: data.id } : undefined,
            AND: [
              {
                OR: [
                  { startsAt: null },
                  { startsAt: { lte: endsAt ?? new Date("9999-12-31") } },
                ],
              },
              {
                OR: [
                  { endsAt: null },
                  { endsAt: { gte: startsAt ?? new Date("1900-01-01") } },
                ],
              },
            ],
          },
          select: { title: true },
        });
        if (overlap) {
          return {
            ok: false as const,
            error: `Period se preklapa sa aktivnim banerom „${overlap.title}“.`,
          };
        }
      }
      const payload = {
        title: data.title,
        subtitle: data.subtitle || null,
        ctaLabel: data.ctaLabel || null,
        ctaHref: data.ctaHref || null,
        imageDesktop: data.imageDesktop,
        imageMobile: data.imageMobile || null,
        startsAt,
        endsAt,
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

/** Move a hero slide up/down by renormalizing `order` within its placement. */
async function reorderBanner(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "banner.reorder", entity: "Banner" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const dir = String(formData.get("dir") ?? "");
      if (!id || (dir !== "up" && dir !== "down")) {
        return { ok: false as const, error: "Neispravan zahtev." };
      }
      const current = await db.banner.findUnique({ where: { id } });
      if (!current) return { ok: false as const, error: "Baner ne postoji." };

      const siblings = await db.banner.findMany({
        where: { placement: current.placement },
        orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      });
      const index = siblings.findIndex((s) => s.id === id);
      const swapIndex = dir === "up" ? index - 1 : index + 1;
      if (index === -1 || swapIndex < 0 || swapIndex >= siblings.length) {
        return { ok: true as const, entityId: id };
      }

      const reordered = [...siblings];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(swapIndex, 0, moved);

      await db.$transaction(
        reordered.map((banner, i) =>
          db.banner.update({ where: { id: banner.id }, data: { order: i } }),
        ),
      );
      revalidatePath("/admin/baneri");
      revalidatePath("/");
      return { ok: true as const, entityId: id };
    },
  )(formData);
}

function dtLocal(value?: Date | null) {
  if (!value) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function scheduleLabel(startsAt: Date | null, endsAt: Date | null) {
  if (!startsAt && !endsAt) return "Stalno";
  const fmt = (d: Date) => new Intl.DateTimeFormat("sr-Latn-RS").format(d);
  return `${startsAt ? fmt(startsAt) : "—"} → ${endsAt ? fmt(endsAt) : "—"}`;
}

export default async function BannersPage() {
  await requireAdminAction(["CONTENT"]);
  const banners = await db.banner.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
  });
  const byPlacement = new Map<BannerPlacement, typeof banners>();
  for (const section of SECTIONS) byPlacement.set(section.placement, []);
  for (const banner of banners) {
    byPlacement.get(banner.placement)?.push(banner);
  }

  return (
    <>
      <PageHeader
        title="Baneri"
        description="Tri fiksne pozicije banera na početnoj. Glavni baner je carousel sa više slika; druga dva su pojedinačne slike."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Baneri" }]}
      />
      <div className="space-y-6 px-8 py-6">
        {SECTIONS.map((section) => (
          <BannerSection
            key={section.placement}
            section={section}
            banners={byPlacement.get(section.placement) ?? []}
          />
        ))}
      </div>
    </>
  );
}

function BannerSection({
  section,
  banners,
}: {
  section: SectionDef;
  banners: Awaited<ReturnType<typeof db.banner.findMany>>;
}) {
  const isCarousel = section.kind === "carousel";
  const activeCount = banners.filter((b) => b.enabled).length;

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-1 border-b border-border/60 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-900">{section.title}</h2>
          <span className="rounded-full bg-muted-bg px-2.5 py-0.5 text-xs text-ink-600">
            {banners.length} {isCarousel ? "slajdova" : "banera"} · {activeCount} aktivnih
          </span>
        </div>
        <p className="text-sm text-ink-500">{section.where}</p>
        <p className="text-xs text-ink-500">
          Preporučena dimenzija: <strong>{section.desktopSize}</strong>
          {section.mobileSize ? ` (desktop), ${section.mobileSize} (mobilna)` : ""}
        </p>
        <p className="text-xs text-ink-400">{section.hint}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-[1fr_440px]">
        <div className="space-y-3">
          {banners.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center text-sm text-ink-500">
              {isCarousel
                ? "Još nema slajdova. Dodajte prvi sa desne strane."
                : "Još nema banera za ovu poziciju. Dodajte ga sa desne strane."}
            </p>
          ) : (
            banners.map((banner, index) => (
              <article
                key={banner.id}
                className="flex gap-3 rounded-xl border border-border/60 bg-surface p-3"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={banner.imageDesktop}
                  alt={banner.title}
                  className="h-16 w-28 shrink-0 rounded-md object-cover ring-1 ring-border/60"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-ink-900">{banner.title}</p>
                    {!banner.enabled ? (
                      <span className="rounded bg-ink-500/10 px-1.5 py-0.5 text-[10px] text-ink-500">
                        neaktivan
                      </span>
                    ) : null}
                    {!isCarousel && index === 0 && banner.enabled ? (
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
                        prikazuje se
                      </span>
                    ) : null}
                  </div>
                  {banner.subtitle ? (
                    <p className="truncate text-xs text-ink-500">{banner.subtitle}</p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-ink-400">
                    {scheduleLabel(banner.startsAt, banner.endsAt)}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {isCarousel ? (
                      <div className="flex items-center gap-1">
                        <form action={reorderBanner}>
                          <input type="hidden" name="id" value={banner.id} />
                          <input type="hidden" name="dir" value="up" />
                          <SubmitButton variant="outline" size="xs" pendingLabel="…">
                            ↑
                          </SubmitButton>
                        </form>
                        <form action={reorderBanner}>
                          <input type="hidden" name="id" value={banner.id} />
                          <input type="hidden" name="dir" value="down" />
                          <SubmitButton variant="outline" size="xs" pendingLabel="…">
                            ↓
                          </SubmitButton>
                        </form>
                      </div>
                    ) : null}
                    <details className="group">
                      <summary className="cursor-pointer list-none rounded-md border border-border px-2 py-1 text-xs text-walnut transition hover:bg-muted">
                        Izmeni
                      </summary>
                      <div className="mt-3 rounded-lg border border-border/60 bg-muted-bg/30 p-3">
                        <BannerForm
                          action={upsertBanner}
                          placement={section.placement}
                          values={{
                            ...banner,
                            startsAt: dtLocal(banner.startsAt),
                            endsAt: dtLocal(banner.endsAt),
                          }}
                        />
                      </div>
                    </details>
                    <form action={deleteBanner}>
                      <input type="hidden" name="id" value={banner.id} />
                      <ConfirmSubmitButton
                        size="xs"
                        confirm={`Obrisati „${banner.title}“? Ova akcija je nepovratna.`}
                        pendingLabel="…"
                      >
                        Obriši
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>

        <Card>
          <CardTitle
            description={
              isCarousel
                ? "Svaki dodati slajd se odmah prikazuje u carousel-u ako je aktivan i u periodu prikaza."
                : "Nova slika se odmah prikazuje ako je aktivna i u periodu prikaza."
            }
          >
            {isCarousel ? "Dodaj slajd u carousel" : "Dodaj/zameni baner"}
          </CardTitle>
          <BannerForm action={upsertBanner} placement={section.placement} />
        </Card>
      </div>
    </Card>
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
};

function BannerForm({
  action,
  placement,
  values,
}: {
  action: (
    state: AdminActionState,
    formData: FormData,
  ) => Promise<AdminActionState>;
  placement: BannerPlacement;
  values?: BannerFormValues;
}) {
  // New banners are appended to the end of their placement (renormalized on reorder).
  const orderValue = values?.id ? (values.order ?? 0) : 9999;
  return (
    <AdminActionForm action={action} className="space-y-4">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <input type="hidden" name="placement" value={placement} />
      <input type="hidden" name="order" value={orderValue} />
      <Field label="Naslov">
        <Input name="title" required defaultValue={values?.title ?? ""} />
      </Field>
      <Field label="Podnaslov">
        <Textarea name="subtitle" rows={2} defaultValue={values?.subtitle ?? ""} />
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
      <div className="flex justify-end gap-2">
        {values?.id ? (
          <Button type="reset" variant="outline" size="sm">
            Resetuj
          </Button>
        ) : null}
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj"}</SubmitButton>
      </div>
    </AdminActionForm>
  );
}
