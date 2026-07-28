"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import { db } from "@/lib/db";
import {
  EMPTY_HERO_PICTOGRAMS,
  LANDING_PICTOGRAM_SLOTS,
  landingBlocksSchema,
  landingSnapshotSchema,
  legacySectionsToBlocks,
  parseLandingBlocks,
  parseLandingSnapshot,
  validateLandingBlocksForPublish,
  type LandingHeroPictograms,
  type LandingPageSnapshot,
} from "@/lib/landing-pages/blocks";
import { webStorefrontProductWhere } from "@/lib/web-storefront-availability";

const landingSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const landingInputSchema = z.object({
  id: z.string().trim().nullable(),
  slug: z.string().trim().min(2).max(120).regex(
    landingSlugPattern,
    "Slug može da sadrži mala slova, brojeve i crtice.",
  ),
  snapshot: landingSnapshotSchema,
  intent: z.enum(["save", "publish"]),
});

function textValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function normalizeLandingSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseJson(value: FormDataEntryValue | null) {
  try {
    return JSON.parse(String(value ?? "")) as unknown;
  } catch {
    return null;
  }
}

function parseLandingInput(formData: FormData) {
  const blocksResult = landingBlocksSchema.safeParse(parseJson(formData.get("blocks")));
  const heroPictograms = parseJson(formData.get("heroPictograms"));
  return landingInputSchema.safeParse({
    id: textValue(formData, "id"),
    slug: normalizeLandingSlug(String(formData.get("slug") ?? "")),
    snapshot: {
      legacySectionsFallback: false,
      title: String(formData.get("title") ?? "").trim(),
      lead: textValue(formData, "lead"),
      heroImageUrl: textValue(formData, "heroImageUrl"),
      heroMobileImageUrl: textValue(formData, "heroMobileImageUrl"),
      heroImageAlt: textValue(formData, "heroImageAlt"),
      heroCtaLabel: textValue(formData, "heroCtaLabel"),
      heroCtaHref: textValue(formData, "heroCtaHref"),
      heroPictograms: heroPictograms ?? EMPTY_HERO_PICTOGRAMS,
      blocks: blocksResult.success ? blocksResult.data : parseJson(formData.get("blocks")),
      seoTitle: textValue(formData, "seoTitle"),
      seoDescription: textValue(formData, "seoDescription"),
      ogImageUrl: textValue(formData, "ogImageUrl"),
      canonicalUrl: textValue(formData, "canonicalUrl"),
      robotsIndex: formData.get("robotsIndex") === "on",
      startsAt: textValue(formData, "startsAt"),
      endsAt: textValue(formData, "endsAt"),
    },
    intent: formData.get("intent") === "publish" ? "publish" : "save",
  });
}

function refreshLandingPaths(...slugs: Array<string | null | undefined>) {
  revalidatePath("/admin/erp/landing-strane");
  revalidatePath("/sitemap.xml");
  for (const slug of new Set(slugs.filter(Boolean))) {
    revalidatePath(`/ponuda/${slug}`);
  }
  revalidateTag("storefront-landing-pages", { expire: 0 });
}

function snapshotData(snapshot: LandingPageSnapshot) {
  return {
    title: snapshot.title,
    lead: snapshot.lead,
    heroImageUrl: snapshot.heroImageUrl,
    heroMobileImageUrl: snapshot.heroMobileImageUrl,
    heroImageAlt: snapshot.heroImageAlt,
    heroCtaLabel: snapshot.heroCtaLabel,
    heroCtaHref: snapshot.heroCtaHref,
    ogImageUrl: snapshot.ogImageUrl,
    canonicalUrl: snapshot.canonicalUrl,
    robotsIndex: snapshot.robotsIndex,
    blocks: snapshot.blocks as Prisma.InputJsonValue,
    seoTitle: snapshot.seoTitle,
    seoDescription: snapshot.seoDescription,
    startsAt: snapshot.startsAt ? new Date(snapshot.startsAt) : null,
    endsAt: snapshot.endsAt ? new Date(snapshot.endsAt) : null,
  };
}

async function validateReferencesForPublish(snapshot: LandingPageSnapshot) {
  const issues = validateLandingBlocksForPublish(snapshot.blocks);
  if (snapshot.startsAt && snapshot.endsAt && snapshot.startsAt >= snapshot.endsAt) {
    issues.push("Kraj objave mora biti posle početka objave.");
  }
  if (snapshot.heroCtaLabel && !snapshot.heroCtaHref) {
    issues.push("Hero dugme mora imati link.");
  }
  if (snapshot.heroCtaHref && !snapshot.heroCtaLabel) {
    issues.push("Hero link mora imati naziv dugmeta.");
  }
  if (snapshot.canonicalUrl && !/^https:\/\//.test(snapshot.canonicalUrl) && !snapshot.canonicalUrl.startsWith("/")) {
    issues.push("Canonical URL mora biti interni put ili HTTPS URL.");
  }

  const productSkus = Array.from(new Set(snapshot.blocks.flatMap((block) =>
    block.type === "PRODUCT_GRID" ? block.productSkus : [],
  )));
  if (productSkus.length) {
    const found = await db.product.findMany({
      where: { ...webStorefrontProductWhere(), sku: { in: productSkus }, deletedAt: null },
      select: { sku: true },
    });
    const foundSet = new Set(found.map((product) => product.sku));
    const missing = productSkus.filter((sku) => !foundSet.has(sku));
    if (missing.length) issues.push(`Nepostojeći SKU kodovi: ${missing.join(", ")}.`);
  }

  const pictogramIds = Array.from(new Set([
    ...Object.values(snapshot.heroPictograms).filter((id): id is string => Boolean(id)),
    ...snapshot.blocks.flatMap((block) =>
      block.type === "PICTOGRAM_ROW" ? block.items.map((item) => item.pictogramId) : [],
    ),
  ]));
  if (pictogramIds.length) {
    const found = await db.pictogram.findMany({
      where: { id: { in: pictogramIds } },
      select: { id: true },
    });
    const foundSet = new Set(found.map((pictogram) => pictogram.id));
    if (pictogramIds.some((id) => !foundSet.has(id))) {
      issues.push("Jedan ili više izabranih piktograma više ne postoji.");
    }
  }
  return issues;
}

async function replaceHeroPlacements(
  tx: Prisma.TransactionClient,
  pageId: string,
  placements: LandingHeroPictograms,
) {
  await tx.pictogramPlacement.deleteMany({ where: { landingPageId: pageId } });
  const data = LANDING_PICTOGRAM_SLOTS.flatMap((slot) => {
    const pictogramId = placements[slot];
    return pictogramId ? [{ landingPageId: pageId, pictogramId, slot }] : [];
  });
  if (data.length) await tx.pictogramPlacement.createMany({ data });
}

export async function saveLandingPageAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const intent = formData.get("intent") === "publish" ? "publish" : "save";
  const state = await withAdminState(
    {
      allowed: ["CONTENT"],
      action: intent === "publish" ? "landing-page.publish" : "landing-page.saveDraft",
      entity: "LandingPage",
    },
    async (actorId, submitted: FormData) => {
      const parsed = parseLandingInput(submitted);
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Proverite podatke landing strane.",
        };
      }
      const { id, slug, snapshot } = parsed.data;
      const existing = id ? await db.landingPage.findUnique({ where: { id } }) : null;
      if (id && !existing) return { ok: false as const, error: "Landing strana ne postoji." };
      if (existing?.publishedRevisionId && existing.slug !== slug) {
        return { ok: false as const, error: "Slug ranije objavljene strane ne može da se menja." };
      }
      const duplicate = await db.landingPage.findFirst({
        where: { slug, id: existing ? { not: existing.id } : undefined },
        select: { id: true },
      });
      if (duplicate) return { ok: false as const, error: "Landing strana sa ovim slug-om već postoji." };
      if (intent === "publish") {
        const issues = await validateReferencesForPublish(snapshot);
        if (issues.length) return { ok: false as const, error: issues[0] };
      }

      const saved = await db.$transaction(async (tx) => {
        const page = existing ?? await tx.landingPage.create({
          data: {
            slug,
            ...snapshotData(snapshot),
            status: "DRAFT",
          },
        });
        const latest = await tx.landingPageRevision.findFirst({
          where: { pageId: page.id },
          select: { version: true },
          orderBy: { version: "desc" },
        });
        const revision = await tx.landingPageRevision.create({
          data: {
            pageId: page.id,
            version: (latest?.version ?? 0) + 1,
            snapshot: snapshot as Prisma.InputJsonValue,
            createdById: actorId,
          },
        });
        await replaceHeroPlacements(tx, page.id, snapshot.heroPictograms);
        return tx.landingPage.update({
          where: { id: page.id },
          data: {
            slug,
            ...snapshotData(snapshot),
            draftRevisionId: revision.id,
            ...(intent === "publish"
              ? {
                  status: "PUBLISHED" as const,
                  publishedAt: new Date(),
                  publishedRevisionId: revision.id,
                  archivedAt: null,
                }
              : {}),
          },
          select: { id: true, slug: true },
        });
      });

      refreshLandingPaths(existing?.slug, saved.slug);
      return {
        ok: true as const,
        entityId: saved.id,
        message: intent === "publish" ? "Landing strana je objavljena." : "Nacrt je sačuvan.",
        result: { id: saved.id, created: !existing },
        diff: { slug: saved.slug, intent, blockCount: snapshot.blocks.length },
      };
    },
  )(formData);
  if (state.ok && state.result?.created) redirect(`/admin/erp/landing-strane/${state.result.id}`);
  return state;
}

export async function restoreLandingRevisionAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "landing-page.restore", entity: "LandingPage" },
    async (actorId, submitted: FormData) => {
      const pageId = String(submitted.get("pageId") ?? "");
      const revisionId = String(submitted.get("revisionId") ?? "");
      const restored = await db.$transaction(async (tx) => {
        const [page, source, latest] = await Promise.all([
          tx.landingPage.findUnique({ where: { id: pageId } }),
          tx.landingPageRevision.findFirst({ where: { id: revisionId, pageId } }),
          tx.landingPageRevision.findFirst({
            where: { pageId }, select: { version: true }, orderBy: { version: "desc" },
          }),
        ]);
        if (!page || !source) return null;
        const parsed = parseLandingSnapshot(source.snapshot);
        if (!parsed.success) return null;
        const revision = await tx.landingPageRevision.create({
          data: {
            pageId,
            version: (latest?.version ?? 0) + 1,
            snapshot: parsed.data as Prisma.InputJsonValue,
            createdById: actorId,
          },
        });
        await replaceHeroPlacements(tx, pageId, parsed.data.heroPictograms);
        return tx.landingPage.update({
          where: { id: pageId },
          data: { ...snapshotData(parsed.data), draftRevisionId: revision.id },
          select: { id: true, slug: true },
        });
      });
      if (!restored) return { ok: false as const, error: "Verzija nije pronađena ili nije ispravna." };
      refreshLandingPaths(restored.slug);
      return {
        ok: true as const, entityId: restored.id,
        message: "Verzija je vraćena kao novi nacrt.", diff: { revisionId },
      };
    },
  )(formData);
}

async function changeLandingState(
  state: "archive" | "unarchive" | "unpublish",
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: `landing-page.${state}`, entity: "LandingPage" },
    async (_actorId, submitted: FormData) => {
      const id = String(submitted.get("id") ?? "");
      const page = await db.landingPage.findUnique({ where: { id } });
      if (!page) return { ok: false as const, error: "Landing strana nije pronađena." };
      await db.landingPage.update({
        where: { id },
        data: state === "archive"
          ? { status: "ARCHIVED", archivedAt: new Date() }
          : state === "unarchive"
            ? { status: "DRAFT", archivedAt: null }
            : { status: "DRAFT", archivedAt: null },
      });
      refreshLandingPaths(page.slug);
      return {
        ok: true as const, entityId: id,
        message: state === "archive" ? "Landing strana je arhivirana." : state === "unpublish" ? "Landing strana je povučena sa sajta." : "Landing strana je vraćena među nacrte.",
        diff: { slug: page.slug, state },
      };
    },
  )(formData);
}

export async function archiveLandingPageAction(_state: AdminActionState, formData: FormData) {
  return changeLandingState("archive", formData);
}
export async function unarchiveLandingPageAction(_state: AdminActionState, formData: FormData) {
  return changeLandingState("unarchive", formData);
}
export async function unpublishLandingPageAction(_state: AdminActionState, formData: FormData) {
  return changeLandingState("unpublish", formData);
}

export async function duplicateLandingPageAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const state = await withAdminState(
    { allowed: ["CONTENT"], action: "landing-page.duplicate", entity: "LandingPage" },
    async (actorId, submitted: FormData) => {
      const id = String(submitted.get("id") ?? "");
      const page = await db.landingPage.findUnique({
        where: { id }, include: { draftRevision: true, sections: { orderBy: { position: "asc" } }, pictogramPlacements: true },
      });
      if (!page) return { ok: false as const, error: "Landing strana nije pronađena." };
      const source = page.draftRevision ? parseLandingSnapshot(page.draftRevision.snapshot) : null;
      const baseSnapshot: LandingPageSnapshot = source?.success ? {
        ...source.data,
        legacySectionsFallback: false,
        heroPictograms: source.data.legacySectionsFallback
          ? { ...source.data.heroPictograms, ...Object.fromEntries(page.pictogramPlacements.map((item) => [item.slot, item.pictogramId])) }
          : source.data.heroPictograms,
        blocks: source.data.legacySectionsFallback
          ? legacySectionsToBlocks(page.sections)
          : source.data.blocks,
      } : {
        legacySectionsFallback: false,
        title: page.title,
        lead: page.lead,
        heroImageUrl: page.heroImageUrl,
        heroMobileImageUrl: page.heroMobileImageUrl,
        heroImageAlt: page.heroImageAlt,
        heroCtaLabel: page.heroCtaLabel,
        heroCtaHref: page.heroCtaHref,
        heroPictograms: { ...EMPTY_HERO_PICTOGRAMS, ...Object.fromEntries(page.pictogramPlacements.map((item) => [item.slot, item.pictogramId])) },
        blocks: parseLandingBlocks(page.blocks),
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        ogImageUrl: page.ogImageUrl,
        canonicalUrl: null,
        robotsIndex: false,
        startsAt: null,
        endsAt: null,
      };
      let slug = `${page.slug}-kopija`;
      let suffix = 2;
      while (await db.landingPage.findUnique({ where: { slug }, select: { id: true } })) {
        slug = `${page.slug}-kopija-${suffix++}`;
      }
      const snapshot = { ...baseSnapshot, title: `${baseSnapshot.title} — kopija`, canonicalUrl: null, robotsIndex: false, startsAt: null, endsAt: null };
      const duplicate = await db.$transaction(async (tx) => {
        const created = await tx.landingPage.create({ data: { slug, ...snapshotData(snapshot), status: "DRAFT" } });
        const revision = await tx.landingPageRevision.create({ data: { pageId: created.id, version: 1, snapshot: snapshot as Prisma.InputJsonValue, createdById: actorId } });
        await replaceHeroPlacements(tx, created.id, snapshot.heroPictograms);
        return tx.landingPage.update({ where: { id: created.id }, data: { draftRevisionId: revision.id }, select: { id: true } });
      });
      refreshLandingPaths(slug);
      return { ok: true as const, entityId: duplicate.id, message: "Kopija je napravljena.", result: { id: duplicate.id }, diff: { sourceId: id, slug } };
    },
  )(formData);
  if (state.ok && state.result?.id) redirect(`/admin/erp/landing-strane/${state.result.id}`);
  return state;
}

export async function deleteLandingDraftAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const state = await withAdminState(
    { allowed: ["CONTENT"], action: "landing-page.deleteDraft", entity: "LandingPage" },
    async (_actorId, submitted: FormData) => {
      const id = String(submitted.get("id") ?? "");
      const page = await db.landingPage.findUnique({ where: { id } });
      if (!page) return { ok: false as const, error: "Landing strana nije pronađena." };
      if (page.publishedRevisionId) {
        return { ok: false as const, error: "Može se obrisati samo nacrt koji nikada nije objavljen. Koristite arhiviranje." };
      }
      await db.landingPage.delete({ where: { id } });
      refreshLandingPaths(page.slug);
      return { ok: true as const, entityId: id, message: "Nacrt je obrisan.", diff: { slug: page.slug } };
    },
  )(formData);
  if (state.ok) redirect("/admin/erp/landing-strane");
  return state;
}
