import Link from "next/link";
import { randomBytes } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { ActionKind, LandingPageStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { logOperationalError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";
import {
  getManagedMobileShortcutIconKey,
  MOBILE_SHORTCUT_ICON_PREFIX,
  validateMobileShortcutIconFile,
} from "@/lib/mobile-shortcuts/icon-file";
import {
  landingPageIsLive,
  resolveMobileTabDestination,
  resolveMobileTabHref,
} from "@/lib/mobile-shortcuts/server";
import { MOBILE_SHORTCUT_COUNT } from "@/lib/mobile-shortcuts/shared";
import { LANDING_PAGE_OPTIONS } from "@/lib/storefront/homepage";
import { mobileShortcutTabs } from "@/data/site";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardTitle } from "@/components/admin/card";
import { Field } from "@/components/admin/field";
import { AdminActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { PromoShortcutTile } from "@/components/home/promo-shortcut-tile";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Mobilni prečaci",
  robots: { index: false, follow: false },
};

const builtInIcons = [
  { label: "Akcija", value: "/brand/promo-stickers/akcija.svg" },
  { label: "Heroji meseca", value: "/brand/heroji-meseca.png" },
  { label: "Trajno niske cene", value: "/brand/tnc-black.svg" },
  { label: "Dok traju zalihe", value: "/brand/promo-stickers/dtz2.svg" },
] as const;

const fixedDestinations = [
  { label: "Početna strana", href: "/" },
  { label: "Mesečna akcija", href: "/akcija" },
  { label: "Nedeljna akcija", href: "/nedeljna-akcija" },
  { label: "Heroji meseca", href: "/heroji-meseca" },
  { label: "Trajno niske cene", href: "/niske-cene-pod-zastitom" },
  { label: "Dok traju zalihe", href: "/ogranicena-ponuda" },
  { label: "Sve do 999", href: "/sve-do-999" },
  { label: "Novo", href: "/novo" },
  { label: "Outlet", href: "/outlet" },
  { label: "Pretraga", href: "/pretraga" },
  ...LANDING_PAGE_OPTIONS.map((page) => ({
    label: page.label,
    href: page.href,
  })),
].filter(
  (item, index, all) =>
    all.findIndex((candidate) => candidate.href === item.href) === index,
);

const saveSchema = z.object({
  position: z.coerce.number().int().min(1).max(MOBILE_SHORTCUT_COUNT),
  label: z.string().trim().min(2, "Naziv mora imati najmanje 2 znaka.").max(50),
  icon: z.string().trim().max(500).optional(),
  destination: z.string().trim().optional(),
  customHref: z.string().trim().max(1_000).optional(),
});

type AdminMobileShortcutRow = {
  id: string | null;
  label: string;
  icon: string | null;
  position: number;
  enabled: boolean;
  actionId: string | null;
  landingPageId: string | null;
  href: string | null;
  action: {
    slug: string;
    kind: ActionKind;
    name: string;
    startsAt: Date;
    endsAt: Date;
  } | null;
  landingPage: {
    slug: string;
    title: string;
    status: LandingPageStatus;
    startsAt: Date | null;
    endsAt: Date | null;
  } | null;
};

async function uploadShortcutIcon(position: number, file: File) {
  const extension = validateMobileShortcutIconFile(file);
  const key = `${MOBILE_SHORTCUT_ICON_PREFIX}slot-${position}-${Date.now()}-${randomBytes(8).toString("hex")}.${extension}`;
  const storage = createAdminClient().storage.from(getProductMediaBucket());
  const { error } = await storage.upload(key, Buffer.from(await file.arrayBuffer()), {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`Upload ikone nije uspeo: ${error.message}`);
  const { data } = storage.getPublicUrl(key);
  if (!data.publicUrl) {
    await storage.remove([key]);
    throw new Error("Javni URL otpremljene ikone nije moguće napraviti.");
  }
  return { key, iconUrl: data.publicUrl };
}

async function removeUnusedManagedIcon(
  iconUrl: string | null | undefined,
  context: Record<string, unknown>,
) {
  const key = getManagedMobileShortcutIconKey(iconUrl);
  if (!key) return;
  const references = await db.mobileTab.count({ where: { icon: iconUrl } });
  if (references > 0) return;
  const { error } = await createAdminClient()
    .storage
    .from(getProductMediaBucket())
    .remove([key]);
  if (error) {
    logOperationalError("mobile_shortcut.icon_cleanup_failed", error, {
      ...context,
      key,
    });
  }
}

function revalidateMobileShortcuts() {
  revalidateTag("storefront-home", { expire: 0 });
  revalidatePath("/");
  revalidatePath("/admin/erp/mobilni-tabovi");
}

async function saveMobileShortcut(
  _state: AdminActionState,
  formData: FormData,
) {
  "use server";

  return withAdminState(
    {
      allowed: ["CONTENT"],
      action: "mobileShortcut.save",
      entity: "MobileTab",
    },
    async (_actorId, formData: FormData) => {
      const parsed = saveSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Proverite unete podatke.",
        };
      }

      const { position, label, destination, customHref } = parsed.data;
      const enabled = formData.get("enabled") === "on";
      let resolved;
      try {
        resolved = await resolveMobileTabDestination({
          selection: destination,
          customHref,
          enabled,
        });
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Odredište nije ispravno.",
        };
      }

      const existing = await db.mobileTab.findUnique({ where: { position } });
      const file = formData.get("iconFile");
      let uploaded: Awaited<ReturnType<typeof uploadShortcutIcon>> | null = null;
      if (file instanceof File && file.size > 0) {
        try {
          uploaded = await uploadShortcutIcon(position, file);
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : "Upload ikone nije uspeo.",
          };
        }
      }

      const icon = uploaded?.iconUrl ?? parsed.data.icon ?? null;
      let saved;
      try {
        saved = await db.mobileTab.upsert({
          where: { position },
          create: {
            position,
            label,
            icon,
            enabled,
            ...resolved.data,
          },
          update: {
            label,
            icon,
            enabled,
            ...resolved.data,
          },
        });
      } catch (error) {
        if (uploaded) {
          await removeUnusedManagedIcon(uploaded.iconUrl, {
            position,
            reason: "database_save_failed",
          });
        }
        throw error;
      }

      if (existing?.icon && existing.icon !== saved.icon) {
        await removeUnusedManagedIcon(existing.icon, {
          position,
          reason: "icon_replaced",
        });
      }
      revalidateMobileShortcuts();
      return {
        ok: true as const,
        entityId: saved.id,
        diff: {
          before: existing,
          after: {
            label,
            icon,
            enabled,
            destination: resolved.href,
            position,
          },
          storageKey: uploaded?.key,
        },
        message: `Pozicija ${position} je sačuvana.`,
      };
    },
  )(formData);
}

function shortcutContent(row: {
  label: string;
  icon: string | null;
  enabled: boolean;
  actionId: string | null;
  landingPageId: string | null;
  href: string | null;
}) {
  return {
    label: row.label,
    icon: row.icon,
    enabled: row.enabled,
    actionId: row.actionId,
    landingPageId: row.landingPageId,
    href: row.href,
  };
}

async function moveMobileShortcut(formData: FormData) {
  "use server";

  return withAdmin(
    {
      allowed: ["CONTENT"],
      action: "mobileShortcut.move",
      entity: "MobileTab",
    },
    async (_actorId, formData: FormData) => {
      const from = Number(formData.get("from"));
      const to = Number(formData.get("to"));
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 1 ||
        from > MOBILE_SHORTCUT_COUNT ||
        to < 1 ||
        to > MOBILE_SHORTCUT_COUNT ||
        Math.abs(from - to) !== 1
      ) {
        return { ok: false as const, error: "Pozicije za pomeranje nisu ispravne." };
      }
      const [source, target] = await Promise.all([
        db.mobileTab.findUnique({ where: { position: from } }),
        db.mobileTab.findUnique({ where: { position: to } }),
      ]);
      if (!source || !target) {
        return {
          ok: false as const,
          error: "Prvo sačuvajte sve četiri pozicije, pa pokušajte ponovo.",
        };
      }
      await db.$transaction([
        db.mobileTab.update({
          where: { position: from },
          data: shortcutContent(target),
        }),
        db.mobileTab.update({
          where: { position: to },
          data: shortcutContent(source),
        }),
      ]);
      revalidateMobileShortcuts();
      return {
        ok: true as const,
        entityId: source.id,
        diff: { from, to },
        message: `Pozicije ${from} i ${to} su zamenjene.`,
      };
    },
  )(formData);
}

function fallbackRow(position: number): AdminMobileShortcutRow {
  const tab = mobileShortcutTabs[position - 1]!;
  return {
    id: null,
    label: tab.label,
    icon: tab.icon ?? null,
    position,
    enabled: true,
    actionId: null,
    landingPageId: null,
    href: tab.href,
    action: null,
    landingPage: null,
  };
}

function safeShortcutHref(row: AdminMobileShortcutRow) {
  try {
    return resolveMobileTabHref(row) ?? "#";
  } catch {
    return "#";
  }
}

function rowIsCurrentlyActive(row: AdminMobileShortcutRow) {
  if (!row.enabled) return false;
  const now = new Date();
  if (row.action && (row.action.startsAt > now || row.action.endsAt < now)) {
    return false;
  }
  if (row.landingPage && !landingPageIsLive(row.landingPage)) return false;
  return safeShortcutHref(row) !== "#";
}

export default async function MobileShortcutsPage() {
  await requireAdminAction(["CONTENT"]);
  const [storedRows, actions, landingPages, categories, pictograms] =
    await Promise.all([
      db.mobileTab.findMany({
        orderBy: { position: "asc" },
        include: {
          action: {
            select: {
              slug: true,
              kind: true,
              name: true,
              startsAt: true,
              endsAt: true,
            },
          },
          landingPage: {
            select: {
              slug: true,
              title: true,
              status: true,
              startsAt: true,
              endsAt: true,
            },
          },
        },
      }),
      db.action.findMany({
        orderBy: [{ endsAt: "desc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          startsAt: true,
          endsAt: true,
        },
      }),
      db.landingPage.findMany({
        orderBy: [{ updatedAt: "desc" }, { title: "asc" }],
        select: { id: true, title: true, slug: true, status: true },
      }),
      db.category.findMany({
        orderBy: [{ path: "asc" }],
        select: { id: true, name: true, path: true },
      }),
      db.pictogram.findMany({
        orderBy: { label: "asc" },
        select: { id: true, label: true, iconUrl: true },
      }),
    ]);

  const rowByPosition = new Map(
    storedRows.map((row) => [row.position, row as AdminMobileShortcutRow]),
  );
  const rows = Array.from({ length: MOBILE_SHORTCUT_COUNT }, (_, index) =>
    rowByPosition.get(index + 1) ?? fallbackRow(index + 1),
  );

  return (
    <>
      <PageHeader
        title="Mobilni prečaci"
        description="Četiri boksa ispod hero banera na mobilnoj početnoj strani. Piktogram iz centralne biblioteke koristi se i uz naslov izabranog odredišta."
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/erp", label: "ERP" },
          { label: "Mobilni prečaci" },
        ]}
        actions={
          <>
            <Link
              href="/admin/erp/landing-strane"
              className={buttonVariants({ variant: "outline" })}
            >
              Landing strane
            </Link>
            <Link
              href="/admin/erp/landing-sekcije"
              className={buttonVariants({ variant: "outline" })}
            >
              Sekcije strana
            </Link>
            <Link
              href="/admin/piktogrami"
              className={buttonVariants({ variant: "outline" })}
            >
              Biblioteka ikona
            </Link>
          </>
        }
      />

      <main className="space-y-6 px-8 py-6">
        <div className="rounded-xl border border-brand-blue/15 bg-brand-blue-50 px-4 py-3 text-sm text-brand-blue">
          Na telefonu se prikazuju samo uključene pozicije. Prilagođeni link ima
          prednost nad izborom iz liste; interni link mora već da postoji.
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          {rows.map((row) => (
            <ShortcutEditor
              key={row.position}
              row={row}
              actions={actions}
              landingPages={landingPages}
              categories={categories}
              pictograms={pictograms}
            />
          ))}
        </div>
      </main>
    </>
  );
}

function ShortcutEditor({
  row,
  actions,
  landingPages,
  categories,
  pictograms,
}: {
  row: AdminMobileShortcutRow;
  actions: Array<{
    id: string;
    name: string;
    kind: string;
    startsAt: Date;
    endsAt: Date;
  }>;
  landingPages: Array<{
    id: string;
    title: string;
    slug: string;
    status: string;
  }>;
  categories: Array<{ id: string; name: string; path: string }>;
  pictograms: Array<{ id: string; label: string; iconUrl: string }>;
}) {
  const href = safeShortcutHref(row);
  const fixedHrefSet = new Set(fixedDestinations.map((item) => item.href));
  const isCustomHref = Boolean(row.href && !fixedHrefSet.has(row.href));
  const destination = row.actionId
    ? `action:${row.actionId}`
    : row.landingPageId
      ? `landing:${row.landingPageId}`
      : row.href && !isCustomHref
        ? `href:${row.href}`
        : "";
  const currentIconIsListed = builtInIcons.some(
    (option) => option.value === row.icon,
  ) || pictograms.some((pictogram) => pictogram.iconUrl === row.icon);
  const live = rowIsCurrentlyActive(row);

  return (
    <Card id={`mobile-shortcut-${row.position}`} className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <CardTitle description="Redosled ide sleva nadesno, zatim u drugi red.">
          Pozicija {row.position}
        </CardTitle>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            live
              ? "bg-success/10 text-success"
              : row.enabled
                ? "bg-warning/15 text-warning"
                : "bg-muted text-ink-500",
          )}
        >
          {live ? "Aktivan" : row.enabled ? "Nije trenutno vidljiv" : "Isključen"}
        </span>
      </div>

      <div className="mb-5 rounded-xl bg-muted-bg p-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
          Pregled na telefonu
        </p>
        <PromoShortcutTile
          canonicalize={false}
          tab={{
            id: row.id ?? `preview-${row.position}`,
            label: row.label,
            href,
            order: row.position,
            icon: row.icon ?? undefined,
          }}
          className="max-w-sm"
        />
      </div>

      <AdminActionForm action={saveMobileShortcut} className="space-y-4">
        <input type="hidden" name="position" value={row.position} />
        <Field label="Naziv u boksu">
          <Input name="label" defaultValue={row.label} required maxLength={50} />
        </Field>

        <Field
          label="Odredište iz sistema"
          hint="Izaberite stranicu, kategoriju, akciju ili landing stranu."
        >
          <select
            name="destination"
            defaultValue={destination}
            className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— Izaberite odredište —</option>
            <optgroup label="Prodavnice i kampanje">
              {fixedDestinations.map((item) => (
                <option key={item.href} value={`href:${item.href}`}>
                  {item.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Kategorije">
              {categories.map((category) => (
                <option key={category.id} value={`href:/k${category.path}`}>
                  {category.name} — /k{category.path}
                </option>
              ))}
            </optgroup>
            <optgroup label="Akcije iz baze">
              {actions.map((action) => (
                <option key={action.id} value={`action:${action.id}`}>
                  {action.name} ({action.kind}; {action.endsAt.toLocaleDateString("sr-RS")})
                </option>
              ))}
            </optgroup>
            <optgroup label="Landing strane iz baze">
              {landingPages.map((page) => (
                <option key={page.id} value={`landing:${page.id}`}>
                  {page.title} ({page.status})
                </option>
              ))}
            </optgroup>
          </select>
        </Field>

        <Field
          label="Prilagođeni link (opciono)"
          hint="Na primer /p/proizvod, /k/kucni-aparati ili https://partner.rs. Ako je popunjen, koristi se umesto izbora iznad."
        >
          <Input
            name="customHref"
            defaultValue={isCustomHref ? row.href ?? "" : ""}
            placeholder="/postojeca-stranica"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Ikona / piktogram"
            hint="Ako izaberete piktogram iz biblioteke, isti znak se prikazuje i levo od naslova odredišne stranice."
          >
            <select
              name="icon"
              defaultValue={row.icon ?? ""}
              className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">Podrazumevana zvezdica</option>
              {!currentIconIsListed && row.icon ? (
                <option value={row.icon}>Trenutna ikona</option>
              ) : null}
              <optgroup label="Brend ikone">
                {builtInIcons.map((icon) => (
                  <option key={icon.value} value={icon.value}>
                    {icon.label}
                  </option>
                ))}
              </optgroup>
              {pictograms.length ? (
                <optgroup label="Biblioteka piktograma">
                  {pictograms.map((pictogram) => (
                    <option key={pictogram.id} value={pictogram.iconUrl}>
                      {pictogram.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </Field>

          <Field label="Nova ikona" hint="PNG, JPG ili WebP; najviše 750 KB.">
            <Input
              name="iconFile"
              type="file"
              accept="image/png,image/jpeg,image/webp"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={row.enabled}
            className="size-4 accent-brand-blue"
          />
          Prikaži ovaj boks na mobilnoj početnoj
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton pendingLabel="Čuvanje…">Sačuvaj poziciju</SubmitButton>
          {href !== "#" ? (
            <Link
              href={href}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              Testiraj link
            </Link>
          ) : null}
        </div>
      </AdminActionForm>

      <div className="mt-4 flex gap-2 border-t border-border/60 pt-4">
        {row.position > 1 ? (
          <form action={moveMobileShortcut}>
            <input type="hidden" name="from" value={row.position} />
            <input type="hidden" name="to" value={row.position - 1} />
            <SubmitButton variant="outline" size="sm" pendingLabel="Pomeranje…">
              Pomeri ulevo
            </SubmitButton>
          </form>
        ) : null}
        {row.position < MOBILE_SHORTCUT_COUNT ? (
          <form action={moveMobileShortcut}>
            <input type="hidden" name="from" value={row.position} />
            <input type="hidden" name="to" value={row.position + 1} />
            <SubmitButton variant="outline" size="sm" pendingLabel="Pomeranje…">
              Pomeri udesno
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
