import { db } from "@/lib/db";
import { revalidatePath, updateTag } from "next/cache";
import Image from "next/image";
import { z } from "zod";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { AdminActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/admin/submit-button";
import { DataTable } from "@/components/admin/data-table";
import { LANDING_PAGE_OPTIONS } from "@/lib/storefront/homepage";
import {
  landingPageNavigationOptions,
  landingPageSlugFromDestinationHref,
} from "@/lib/storefront/landing-destinations";
import { getLandingPageForStorefront } from "@/lib/storefront/landing-pages";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Navigacija",
  robots: { index: false, follow: false },
};

const schema = z.object({
  id: z.string().optional().nullable(),
  label: z.string().min(1).max(40),
  href: z.string().min(1).max(200),
  icon: z.string().max(40).optional().nullable(),
  pictogramId: z.string().optional().nullable(),
  order: z.coerce.number().int().min(1).max(10),
  enabled: z.coerce.boolean().default(true),
});

async function upsert(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT"], action: "tab.upsert", entity: "Tab" },
    async (_a, formData: FormData) => {
        const parsed = schema.safeParse({
          ...Object.fromEntries(formData),
          enabled: formData.get("enabled") === "on" || formData.get("enabled") === "true",
        });
        if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Greška." };
        const [occupied, current, pictogram] = await Promise.all([
          db.tab.findFirst({
            where: {
              order: parsed.data.order,
              NOT: parsed.data.id ? { id: parsed.data.id } : undefined,
            },
            select: { id: true },
          }),
          parsed.data.id
            ? db.tab.findUnique({
                where: { id: parsed.data.id },
                select: { href: true },
              })
            : null,
          parsed.data.pictogramId
            ? db.pictogram.findUnique({
                where: { id: parsed.data.pictogramId },
                select: { id: true },
              })
            : null,
        ]);
        if (occupied) {
          return { ok: false as const, error: `Pozicija ${parsed.data.order} je već zauzeta.` };
        }
        if (parsed.data.pictogramId && !pictogram) {
          return { ok: false as const, error: "Izabrani piktogram više ne postoji." };
        }

        const landingPageSlug = landingPageSlugFromDestinationHref(parsed.data.href);
        if (landingPageSlug) {
          const landingPage = await db.landingPage.findUnique({
            where: { slug: landingPageSlug },
            select: { id: true, archivedAt: true },
          });
          if (!landingPage || landingPage.archivedAt) {
            return {
              ok: false as const,
              error: "Izabrana landing strana više ne postoji.",
            };
          }
          if (
            parsed.data.enabled &&
            !(await getLandingPageForStorefront(landingPageSlug))
          ) {
            return {
              ok: false as const,
              error:
                "Aktivna navigacija može da vodi samo na trenutno objavljenu landing stranu.",
            };
          }
        }

        if (parsed.data.enabled) {
          const enabledCount = await db.tab.count({
            where: { enabled: true, NOT: parsed.data.id ? { id: parsed.data.id } : undefined },
          });
          if (enabledCount >= 10) {
            return { ok: false as const, error: "Maksimalno 10 aktivnih tabova." };
          }
        }
        const { id, pictogramId, ...rest } = parsed.data;
        const data = { ...rest, icon: rest.icon || null };
        const saved = id
          ? await db.tab.update({
              where: { id },
              data: {
                ...data,
                pictogram: pictogramId
                  ? { connect: { id: pictogramId } }
                  : { disconnect: true },
              },
            })
          : await db.tab.create({
              data: {
                ...data,
                ...(pictogramId
                  ? { pictogram: { connect: { id: pictogramId } } }
                  : {}),
              },
            });
        revalidatePath("/admin/tabovi");
        revalidatePath("/");
        if (current?.href?.startsWith("/")) revalidatePath(current.href);
        if (saved.href.startsWith("/")) revalidatePath(saved.href);
        updateTag("storefront-home");
        return {
          ok: true as const,
          entityId: saved.id,
          diff: { ...data, pictogramId: pictogramId || null },
          message: "Navigacija i povezani prikazi su sačuvani.",
        };
      },
  )(formData);
}

async function remove(formData: FormData) {
  "use server";

  return withAdmin(
    { allowed: ["CONTENT"], action: "tab.delete", entity: "Tab" },
    async (_a, formData: FormData) => {
        const id = String(formData.get("id") ?? "");
        if (!id) return { ok: false as const, error: "Nedostaje ID." };
        const deleted = await db.tab.delete({ where: { id } });
        revalidatePath("/admin/tabovi");
        revalidatePath("/");
        if (deleted.href.startsWith("/")) revalidatePath(deleted.href);
        updateTag("storefront-home");
        return { ok: true as const, entityId: id };
      },
  )(formData);
}

export default async function TabsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; slot?: string }>;
}) {
  await requireAdminAction(["CONTENT"]);
  const params = await searchParams;
  const [tabs, categories, pictograms, landingPages] = await Promise.all([
    db.tab.findMany({
      orderBy: [{ order: "asc" }, { label: "asc" }],
      include: { pictogram: true },
    }),
    db.category.findMany({ orderBy: { path: "asc" }, select: { name: true, path: true } }),
    db.pictogram.findMany({ orderBy: [{ label: "asc" }, { code: "asc" }] }),
    db.landingPage.findMany({
      where: { archivedAt: null },
      orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
      select: { id: true, slug: true, title: true, status: true },
    }),
  ]);
  const requestedSlot = Number(params.slot);
  const selected = tabs.find((tab) => tab.id === params.edit);
  const firstEmptySlot = Array.from({ length: 10 }, (_, index) => index + 1)
    .find((slot) => !tabs.some((tab) => tab.order === slot)) ?? 1;
  const editorSlot = Number.isInteger(requestedSlot) && requestedSlot >= 1 && requestedSlot <= 10
    ? requestedSlot
    : firstEmptySlot;
  const destinationOptions = [
    ...LANDING_PAGE_OPTIONS.map((page) => ({ value: page.href, label: `Landing · ${page.label}` })),
    ...landingPageNavigationOptions(landingPages),
    ...categories.map((category) => ({ value: `/k${category.path}`, label: `Kategorija · ${category.name}` })),
  ].filter((option, index, all) => all.findIndex((candidate) => candidate.value === option.value) === index);

  return (
    <>
      <PageHeader
        title="Navigacija"
        description="Desktop navigacija sa najviše deset pozicija. Mobilni boksevi ispod hero sekcije podešavaju se u odvojenom ekranu „Mobilni prečaci“."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Navigacija" }]}
      />
      <div className="grid grid-cols-1 items-start gap-6 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="max-h-[calc(100vh-11rem)] overflow-y-auto p-0">
          <div className="sticky top-0 z-10 border-b border-border bg-white px-4 py-3">
            <p className="font-display text-lg font-semibold text-ink-900">Desktop pozicije 1–10</p>
            <p className="text-xs text-ink-500">Kliknite red da ga uredite u desnom editoru.</p>
          </div>
          <DataTable
            columns={[
              { key: "order", label: "Poz.", align: "right" },
              { key: "label", label: "Naziv" },
              { key: "pictogram", label: "Piktogram" },
              { key: "enabled", label: "Aktivan", align: "center" },
              { key: "actions", label: "" },
            ]}
            rows={Array.from({ length: 10 }, (_, index) => {
              const position = index + 1;
              const tab = tabs.find((item) => item.order === position);
              return {
                id: tab?.id ?? `empty-${position}`,
                cells: {
                  order: position,
                  label: tab ? (
                    <div className="min-w-0">
                      <p className="font-medium">{tab.label}</p>
                      <p className="max-w-64 truncate font-mono text-[11px] text-ink-500" title={tab.href}>{tab.href}</p>
                    </div>
                  ) : <span className="text-ink-300">Prazna pozicija</span>,
                  pictogram: tab?.pictogram ? (
                    <div className="flex items-center gap-2">
                      <Image
                        src={tab.pictogram.iconUrl}
                        alt=""
                        width={28}
                        height={28}
                        className="size-7 rounded object-contain"
                      />
                      <span className="text-xs">{tab.pictogram.label}</span>
                    </div>
                  ) : <span className="text-ink-300">—</span>,
                  enabled: tab?.enabled ? "✓" : "—",
                  actions: tab ? (
                    <div className="flex justify-end gap-2">
                      <a href={`/admin/tabovi?edit=${tab.id}`} className="text-xs text-walnut hover:underline">Izmeni</a>
                      <form action={remove}>
                        <input type="hidden" name="id" value={tab.id} />
                        <SubmitButton variant="destructive" size="xs" pendingLabel="…" aria-label={`Obriši ${tab.label}`}>×</SubmitButton>
                      </form>
                    </div>
                  ) : (
                    <a href={`/admin/tabovi?slot=${position}`} className="text-xs font-medium text-walnut hover:underline">Podesi</a>
                  ),
                },
              };
            })}
          />
        </Card>
        <Card className="lg:sticky lg:top-6">
          <CardTitle>{selected ? `Izmena: ${selected.label}` : `Nova navigacija · pozicija ${editorSlot}`}</CardTitle>
          <TabForm
            key={
              selected
                ? [
                    selected.id,
                    selected.label,
                    selected.href,
                    selected.order,
                    selected.enabled,
                    selected.icon ?? "",
                    selected.pictogramId ?? "",
                  ].join(":")
                : `new-${editorSlot}`
            }
            action={upsert}
            values={selected ?? { order: editorSlot }}
            destinations={destinationOptions}
            usedOrders={tabs.filter((tab) => tab.id !== selected?.id).map((tab) => tab.order)}
            pictograms={pictograms}
          />
        </Card>
      </div>
    </>
  );
}

function TabForm({
  action,
  values,
  destinations,
  usedOrders,
  pictograms,
}: {
  action: (
    state: AdminActionState,
    formData: FormData,
  ) => Promise<AdminActionState>;
  values?: { id?: string; label?: string; href?: string; icon?: string | null; pictogramId?: string | null; order?: number; enabled?: boolean };
  destinations: { value: string; label: string }[];
  usedOrders: number[];
  pictograms: { id: string; code: string; label: string; iconUrl: string }[];
}) {
  return (
    <AdminActionForm action={action} className="space-y-3">
      {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Naziv">
        <Input name="label" required defaultValue={values?.label ?? ""} />
      </Field>
      <Field label="Link">
        <select name="href" required defaultValue={values?.href ?? ""} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm">
          <option value="" disabled>Izaberite odredište</option>
          {values?.href && !destinations.some((option) => option.value === values.href) ? (
            <option value={values.href}>Postojeći link · {values.href}</option>
          ) : null}
          {destinations.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </Field>
      <Field label="Piktogram iz biblioteke">
        <select
          name="pictogramId"
          defaultValue={values?.pictogramId ?? ""}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Bez piktograma / podrazumevana ikona</option>
          {pictograms.map((pictogram) => (
            <option key={pictogram.id} value={pictogram.id}>
              {pictogram.label} · {pictogram.code}
            </option>
          ))}
        </select>
      </Field>
      {values?.pictogramId ? (
        <p className="text-xs text-ink-500">
          Ovaj izbor se koristi uz naslov odredišne stranice. Četiri mobilna boksa imaju sopstveno podešavanje u „Mobilnim prečacima“.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Rezervna Lucide ikona">
          <Input name="icon" defaultValue={values?.icon ?? ""} placeholder="lucide ime" />
        </Field>
        <Field label="Redosled">
          <select name="order" defaultValue={values?.order ?? 1} className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm">
            {Array.from({ length: 10 }, (_, index) => index + 1).map((position) => (
              <option key={position} value={position} disabled={usedOrders.includes(position)}>
                Pozicija {position}{usedOrders.includes(position) ? " · zauzeta" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Aktivan">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={values?.enabled ?? true} className="size-4 accent-walnut" />
          Prikaži u meniju
        </label>
      </Field>
      <div className="flex justify-end">
        <SubmitButton>{values?.id ? "Sačuvaj" : "Dodaj"}</SubmitButton>
      </div>
    </AdminActionForm>
  );
}
