import { db } from "@/lib/db";
import { revalidatePath, updateTag } from "next/cache";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { BannerPlacement, type Banner as BannerRecord } from "@prisma/client";
import { withAdmin, withAdminState, requireAdminAction } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { logOperationalError } from "@/lib/monitoring";
import {
  getBuiltInBannerSeeds,
  isBuiltInBannerId,
} from "@/lib/banners/builtins";
import {
  BANNER_IMAGE_PREFIX,
  getManagedBannerImageKey,
  validateBannerImageFile,
} from "@/lib/banners/image-file";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductMediaBucket } from "@/lib/supabase/storage";
import { AdminActionForm } from "@/components/admin/action-form";
import { BannerImageUpload } from "@/components/admin/banner-image-upload";
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

const upsertSchema = z.object({
  id: z.string().optional().nullable(),
  title: z.string().min(1).max(120),
  subtitle: z.string().max(240).optional().nullable(),
  ctaLabel: z.string().max(40).optional().nullable(),
  ctaHref: z.string().max(500).optional().nullable(),
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

type AdminBanner = BannerRecord & {
  source: "database" | "built-in";
};

function builtInAdminBanners(placement: BannerPlacement): AdminBanner[] {
  const now = new Date();
  return getBuiltInBannerSeeds(placement).map((banner) => ({
    id: String(banner.id),
    title: banner.title,
    subtitle: banner.subtitle ?? null,
    ctaLabel: banner.ctaLabel ?? null,
    ctaHref: banner.ctaHref ?? null,
    imageDesktop: banner.imageDesktop,
    imageMobile: banner.imageMobile ?? null,
    startsAt: banner.startsAt ? new Date(banner.startsAt) : null,
    endsAt: banner.endsAt ? new Date(banner.endsAt) : null,
    order: banner.order ?? 0,
    enabled: banner.enabled ?? true,
    placement,
    createdAt: now,
    updatedAt: now,
    source: "built-in",
  }));
}

async function materializeBuiltInBanners(placement: BannerPlacement) {
  const configuredCount = await db.banner.count({ where: { placement } });
  if (configuredCount > 0) return false;

  await db.banner.createMany({
    data: getBuiltInBannerSeeds(placement),
    skipDuplicates: true,
  });
  return true;
}

function selectedFile(formData: FormData, name: string) {
  const value = formData.get(name);
  return value instanceof File && value.size > 0 ? value : null;
}

async function uploadBannerImage(
  file: File,
  placement: BannerPlacement,
  variant: "desktop" | "mobile",
) {
  validateBannerImageFile(file);
  const input = Buffer.from(await file.arrayBuffer());
  let output: Buffer;

  try {
    const metadata = await sharp(input, {
      failOn: "warning",
      limitInputPixels: 80_000_000,
    }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Nedostaju dimenzije slike.");
    }
    output = await sharp(input, {
      failOn: "warning",
      limitInputPixels: 80_000_000,
    })
      .rotate()
      .resize({
        width: 3000,
        height: 3000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 92, effort: 4 })
      .toBuffer();
  } catch {
    throw new Error(
      "Fajl nije čitljiva slika. Izaberite ispravan PNG, JPG, WebP ili AVIF.",
    );
  }

  const key = `${BANNER_IMAGE_PREFIX}${placement.toLowerCase()}/${Date.now()}-${randomBytes(8).toString("hex")}-${variant}.webp`;
  const storage = createAdminClient().storage.from(getProductMediaBucket());
  const { error } = await storage.upload(key, output, {
    cacheControl: "31536000",
    contentType: "image/webp",
    upsert: false,
  });
  if (error) throw new Error(`Upload slike nije uspeo: ${error.message}`);

  const { data } = storage.getPublicUrl(key);
  if (!data.publicUrl) {
    await storage.remove([key]);
    throw new Error("Javni URL otpremljene slike nije moguće napraviti.");
  }
  return { key, url: data.publicUrl };
}

async function removeManagedBannerImages(
  values: Array<string | null | undefined>,
  context: Record<string, unknown>,
) {
  const keys = Array.from(
    new Set(
      values
        .map(getManagedBannerImageKey)
        .filter((key): key is string => Boolean(key)),
    ),
  );
  if (!keys.length) return;

  const { error } = await createAdminClient()
    .storage
    .from(getProductMediaBucket())
    .remove(keys);
  if (error) {
    logOperationalError("banner.image_cleanup_failed", error, {
      ...context,
      keys,
    });
  }
}

async function removeUnreferencedBannerImages(
  values: Array<string | null | undefined>,
  context: Record<string, unknown>,
) {
  const urls = Array.from(new Set(values.filter((value): value is string => Boolean(value))));
  const removable: string[] = [];
  for (const url of urls) {
    if (!getManagedBannerImageKey(url)) continue;
    const references = await db.banner.count({
      where: {
        OR: [{ imageDesktop: url }, { imageMobile: url }],
      },
    });
    if (references === 0) removable.push(url);
  }
  await removeManagedBannerImages(removable, context);
}

function revalidateBannerSurfaces() {
  updateTag("storefront-home");
  revalidatePath("/admin/baneri");
  revalidatePath("/");
  revalidatePath("/niske-cene-pod-zastitom");
}

async function upsertBanner(_state: AdminActionState, formData: FormData) {
  "use server";

  return withAdminState(
    { allowed: ["CONTENT"], action: "banner.upsert", entity: "Banner" },
    async (_actorId, formData: FormData) => {
      const raw = Object.fromEntries(formData.entries());
      const parsed = upsertSchema.safeParse({
        ...raw,
        enabled:
          formData.get("enabled") === "on" ||
          formData.get("enabled") === "true",
      });
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Neispravan unos.",
        };
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

      await materializeBuiltInBanners(data.placement);
      const existing = data.id
        ? await db.banner.findUnique({ where: { id: data.id } })
        : null;
      if (data.id && !existing) {
        return {
          ok: false as const,
          error: "Baner više ne postoji. Osvežite stranicu i pokušajte ponovo.",
        };
      }
      if (existing && existing.placement !== data.placement) {
        return { ok: false as const, error: "Pozicija banera nije ispravna." };
      }

      const desktopFile = selectedFile(formData, "imageDesktopFile");
      const mobileFile = selectedFile(formData, "imageMobileFile");
      const removeMobile = formData.get("removeImageMobile") === "true";
      if (!desktopFile && !existing?.imageDesktop) {
        return {
          ok: false as const,
          error: "Prevucite desktop sliku ili je izaberite sa računara.",
        };
      }

      let uploadedDesktop: Awaited<
        ReturnType<typeof uploadBannerImage>
      > | null = null;
      let uploadedMobile: Awaited<
        ReturnType<typeof uploadBannerImage>
      > | null = null;
      try {
        if (desktopFile) {
          uploadedDesktop = await uploadBannerImage(
            desktopFile,
            data.placement,
            "desktop",
          );
        }
        if (mobileFile && !removeMobile) {
          uploadedMobile = await uploadBannerImage(
            mobileFile,
            data.placement,
            "mobile",
          );
        }
      } catch (error) {
        await removeManagedBannerImages(
          [uploadedDesktop?.url, uploadedMobile?.url],
          { placement: data.placement, reason: "upload_failed" },
        );
        return {
          ok: false as const,
          error:
            error instanceof Error
              ? error.message
              : "Upload slike nije uspeo.",
        };
      }

      const imageDesktop = uploadedDesktop?.url ?? existing?.imageDesktop;
      if (!imageDesktop) {
        await removeManagedBannerImages(
          [uploadedDesktop?.url, uploadedMobile?.url],
          { placement: data.placement, reason: "missing_desktop_after_upload" },
        );
        return { ok: false as const, error: "Desktop slika nije sačuvana." };
      }
      const payload = {
        title: data.title,
        subtitle: data.subtitle || null,
        ctaLabel: data.ctaLabel || null,
        ctaHref: data.ctaHref || null,
        imageDesktop,
        imageMobile: removeMobile
          ? null
          : (uploadedMobile?.url ?? existing?.imageMobile ?? null),
        startsAt,
        endsAt,
        order: data.order,
        enabled: data.enabled,
        placement: data.placement,
      };

      let saved: BannerRecord;
      try {
        saved = await db.$transaction(async (tx) => {
          if (data.enabled && data.placement !== BannerPlacement.HERO) {
            await tx.banner.updateMany({
              where: {
                placement: data.placement,
                enabled: true,
                ...(data.id ? { NOT: { id: data.id } } : {}),
              },
              data: { enabled: false },
            });
          }
          return data.id
            ? tx.banner.update({ where: { id: data.id }, data: payload })
            : tx.banner.create({ data: payload });
        });
      } catch (error) {
        await removeManagedBannerImages(
          [uploadedDesktop?.url, uploadedMobile?.url],
          { placement: data.placement, reason: "database_save_failed" },
        );
        return {
          ok: false as const,
          error:
            error instanceof Error
              ? `Baner nije sačuvan: ${error.message}`
              : "Baner nije sačuvan zbog greške u bazi.",
        };
      }

      await removeUnreferencedBannerImages(
        [
          uploadedDesktop && existing?.imageDesktop !== uploadedDesktop.url
            ? existing?.imageDesktop
            : null,
          (uploadedMobile || removeMobile) &&
          existing?.imageMobile !== uploadedMobile?.url
            ? existing?.imageMobile
            : null,
        ],
        { bannerId: saved.id, reason: "image_replaced" },
      );
      revalidateBannerSurfaces();
      return {
        ok: true as const,
        entityId: saved.id,
        diff: {
          ...payload,
          desktopStorageKey: uploadedDesktop?.key,
          mobileStorageKey: uploadedMobile?.key,
        },
        message: data.id ? "Baner je sačuvan." : "Baner je dodat.",
      };
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
      const placement = z.nativeEnum(BannerPlacement).safeParse(
        formData.get("placement"),
      );
      if (isBuiltInBannerId(id) && placement.success) {
        await materializeBuiltInBanners(placement.data);
      }
      const existing = await db.banner.findUnique({ where: { id } });
      if (!existing) {
        return { ok: false as const, error: "Baner više ne postoji." };
      }
      await db.banner.delete({ where: { id } });
      await removeUnreferencedBannerImages(
        [existing.imageDesktop, existing.imageMobile],
        { bannerId: id, reason: "banner_deleted" },
      );
      revalidateBannerSurfaces();
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
      const placement = z.nativeEnum(BannerPlacement).safeParse(
        formData.get("placement"),
      );
      if (!id || (dir !== "up" && dir !== "down")) {
        return { ok: false as const, error: "Neispravan zahtev." };
      }
      if (isBuiltInBannerId(id) && placement.success) {
        await materializeBuiltInBanners(placement.data);
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
      revalidateBannerSurfaces();
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

function isActiveNow(banner: AdminBanner, now = new Date()) {
  return (
    banner.enabled &&
    (!banner.startsAt || banner.startsAt <= now) &&
    (!banner.endsAt || banner.endsAt >= now)
  );
}

export default async function BannersPage() {
  await requireAdminAction(["CONTENT"]);
  const databaseBanners = await db.banner.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
  });
  const byPlacement = new Map<BannerPlacement, AdminBanner[]>();
  for (const section of SECTIONS) {
    const configured = databaseBanners
      .filter((banner) => banner.placement === section.placement)
      .map((banner) => ({ ...banner, source: "database" as const }));
    byPlacement.set(
      section.placement,
      configured.length
        ? configured
        : builtInAdminBanners(section.placement),
    );
  }

  return (
    <>
      <PageHeader
        title="Baneri"
        description="Svi baneri koji se trenutno vide na početnoj, na jednom mestu. Glavni baner je carousel; druga dva su pojedinačne pozicije."
        crumbs={[{ href: "/admin", label: "Admin" }, { label: "Baneri" }]}
      />
      <div className="space-y-6 px-8 py-6">
        <div className="rounded-xl border border-brand-blue/20 bg-brand-blue/5 px-4 py-3 text-sm text-ink-700">
          Ugrađeni baneri su prikazani zajedno sa sadržajem iz baze. Kada prvi put
          sačuvate izmenu ili dodate slajd, trenutni sadržaj se automatski prenosi
          pod upravljanje administracije — bez nestanka ostalih slajdova.
        </div>
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
  banners: AdminBanner[];
}) {
  const isCarousel = section.kind === "carousel";
  const activeCount = banners.filter((banner) => isActiveNow(banner)).length;

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-1 border-b border-border/60 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-900">{section.title}</h2>
          <span className="rounded-full bg-muted-bg px-2.5 py-0.5 text-xs text-ink-600">
            {banners.length} {isCarousel ? "slajdova" : "banera"} · {activeCount}{" "}
            aktivnih sada
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
                className="flex flex-col gap-4 rounded-xl border border-border/60 bg-surface p-3 lg:flex-row"
              >
                <div className="flex shrink-0 gap-2">
                  <figure className="space-y-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={banner.imageDesktop}
                      alt={`Desktop: ${banner.title}`}
                      className="h-24 w-40 rounded-md bg-muted-bg object-cover ring-1 ring-border/60"
                    />
                    <figcaption className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
                      Desktop
                    </figcaption>
                  </figure>
                  {banner.imageMobile ? (
                    <figure className="space-y-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={banner.imageMobile}
                        alt={`Mobilna: ${banner.title}`}
                        className="h-24 w-16 rounded-md bg-muted-bg object-cover ring-1 ring-border/60"
                      />
                      <figcaption className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
                        Mobilna
                      </figcaption>
                    </figure>
                  ) : (
                    <div className="flex h-24 w-16 items-center justify-center rounded-md border border-dashed border-border/70 px-2 text-center text-[10px] leading-tight text-ink-400">
                      Mobilna koristi desktop
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink-900">{banner.title}</p>
                    {banner.source === "built-in" ? (
                      <span className="rounded bg-brand-blue/10 px-1.5 py-0.5 text-[10px] text-brand-blue">
                        ugrađeni sadržaj
                      </span>
                    ) : null}
                    {!isActiveNow(banner) ? (
                      <span className="rounded bg-ink-500/10 px-1.5 py-0.5 text-[10px] text-ink-500">
                        {banner.enabled ? "van perioda" : "neaktivan"}
                      </span>
                    ) : null}
                    {!isCarousel && index === 0 && isActiveNow(banner) ? (
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">
                        prikazuje se sada
                      </span>
                    ) : null}
                  </div>
                  {banner.subtitle ? (
                    <p className="mt-1 text-xs leading-relaxed text-ink-500">
                      {banner.subtitle}
                    </p>
                  ) : null}
                  {banner.ctaLabel || banner.ctaHref ? (
                    <p className="mt-1 text-xs text-ink-500">
                      Dugme: <strong>{banner.ctaLabel || "—"}</strong>
                      {banner.ctaHref ? ` → ${banner.ctaHref}` : ""}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-ink-400">
                    {scheduleLabel(banner.startsAt, banner.endsAt)}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {isCarousel ? (
                      <div className="flex items-center gap-1">
                        <form action={reorderBanner}>
                          <input type="hidden" name="id" value={banner.id} />
                          <input
                            type="hidden"
                            name="placement"
                            value={section.placement}
                          />
                          <input type="hidden" name="dir" value="up" />
                          <SubmitButton
                            variant="outline"
                            size="xs"
                            pendingLabel="…"
                            aria-label={`Pomeri „${banner.title}“ nagore`}
                            disabled={index === 0}
                          >
                            ↑
                          </SubmitButton>
                        </form>
                        <form action={reorderBanner}>
                          <input type="hidden" name="id" value={banner.id} />
                          <input
                            type="hidden"
                            name="placement"
                            value={section.placement}
                          />
                          <input type="hidden" name="dir" value="down" />
                          <SubmitButton
                            variant="outline"
                            size="xs"
                            pendingLabel="…"
                            aria-label={`Pomeri „${banner.title}“ nadole`}
                            disabled={index === banners.length - 1}
                          >
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
                    {banner.source === "database" ? (
                      <form action={deleteBanner}>
                        <input type="hidden" name="id" value={banner.id} />
                        <input
                          type="hidden"
                          name="placement"
                          value={section.placement}
                        />
                        <ConfirmSubmitButton
                          size="xs"
                          confirm={`Obrisati „${banner.title}“? Ova akcija je nepovratna.`}
                          pendingLabel="…"
                        >
                          Obriši
                        </ConfirmSubmitButton>
                      </form>
                    ) : (
                      <span className="text-[11px] text-ink-400">
                        Sačuvajte izmenu da biste preuzeli upravljanje.
                      </span>
                    )}
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
            {isCarousel ? "Dodaj slajd u carousel" : "Dodaj novi / zameni baner"}
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
  const section = SECTIONS.find((candidate) => candidate.placement === placement);
  return (
    <AdminActionForm action={action} className="space-y-4" refreshOnSuccess>
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
      <BannerImageUpload
        name="imageDesktopFile"
        label="Desktop slika"
        currentUrl={values?.imageDesktop}
        required={!values?.imageDesktop}
        hint={`Preporuka: ${section?.desktopSize ?? "široki format"}. Slika se otprema tek kada sačuvate formu.`}
      />
      <BannerImageUpload
        name="imageMobileFile"
        label="Mobilna slika (opciono)"
        currentUrl={values?.imageMobile}
        removeName="removeImageMobile"
        aspect="mobile"
        hint={`Preporuka: ${section?.mobileSize ?? "uspravni kadar"}. Ako je nema, koristi se desktop slika.`}
      />
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
