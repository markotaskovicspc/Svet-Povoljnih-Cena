"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminState } from "@/lib/admin";
import type { AdminActionState } from "@/lib/admin/action-state";
import {
  normalizeContentSlug,
  validateContentSlug,
} from "@/lib/cms/constants";
import { validateCmsMarkdown } from "@/lib/cms/markdown";

const contentPageInputSchema = z
  .object({
    id: z.string().trim().optional().nullable(),
    slug: z.string().trim().min(2).max(120),
    eyebrow: z.string().trim().max(80).optional().nullable(),
    heroNote: z.string().trim().max(200).optional().nullable(),
    title: z.string().trim().min(1).max(160),
    lead: z.string().trim().max(1000).optional().nullable(),
    bodyMarkdown: z.string().trim().min(1).max(60_000),
    seoTitle: z.string().trim().max(160).optional().nullable(),
    seoDescription: z.string().trim().max(500).optional().nullable(),
    footerVisible: z.boolean(),
    footerLabel: z.string().trim().max(120).optional().nullable(),
    footerColumn: z.enum(["COMPANY", "TERMS"]).optional().nullable(),
    footerOrder: z.coerce.number().int().min(0).max(9999).optional().nullable(),
    intent: z.enum(["save", "publish"]).default("save"),
  })
  .superRefine((value, context) => {
    if (value.footerVisible && !value.footerLabel) {
      context.addIssue({
        code: "custom",
        path: ["footerLabel"],
        message: "Unesite naziv linka u footeru.",
      });
    }
    if (value.footerVisible && !value.footerColumn) {
      context.addIssue({
        code: "custom",
        path: ["footerColumn"],
        message: "Izaberite kolonu footera.",
      });
    }
  });

function formValue(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
}

function parseContentPageInput(formData: FormData) {
  return contentPageInputSchema.safeParse({
    id: formValue(formData, "id"),
    slug: normalizeContentSlug(String(formData.get("slug") ?? "")),
    eyebrow: formValue(formData, "eyebrow"),
    heroNote: formValue(formData, "heroNote"),
    title: String(formData.get("title") ?? ""),
    lead: formValue(formData, "lead"),
    bodyMarkdown: String(formData.get("bodyMarkdown") ?? ""),
    seoTitle: formValue(formData, "seoTitle"),
    seoDescription: formValue(formData, "seoDescription"),
    footerVisible: formData.get("footerVisible") === "on",
    footerLabel: formValue(formData, "footerLabel"),
    footerColumn: formValue(formData, "footerColumn"),
    footerOrder: formValue(formData, "footerOrder"),
    intent: formValue(formData, "intent") ?? "save",
  });
}

function refreshContentPaths(slug: string, refreshFooter: boolean) {
  revalidatePath("/admin/sadrzaj");
  revalidatePath(`/${slug}`);
  revalidatePath("/sitemap.xml");
  if (refreshFooter && slug === "uslovi-isporuke") {
    revalidatePath("/p/[slug]", "page");
  }
  if (refreshFooter) revalidatePath("/", "layout");
}

export async function saveContentPageAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const auditAction =
    formData.get("intent") === "publish"
      ? "content-page.publish"
      : "content-page.saveDraft";
  const state = await withAdminState(
    { allowed: ["CONTENT"], action: auditAction, entity: "ContentPage" },
    async (actorId, formData: FormData) => {
      const parsed = parseContentPageInput(formData);
      if (!parsed.success) {
        return {
          ok: false as const,
          error: parsed.error.issues[0]?.message ?? "Neispravan unos.",
        };
      }
      const input = parsed.data;
      const existing = input.id
        ? await db.contentPage.findUnique({ where: { id: input.id } })
        : null;
      if (input.id && !existing) {
        return { ok: false as const, error: "Stranica više ne postoji." };
      }

      const slugError = validateContentSlug(input.slug, {
        allowSystemSlug: existing?.kind === "SYSTEM",
      });
      if (slugError) return { ok: false as const, error: slugError };
      if (
        existing &&
        (existing.kind === "SYSTEM" || existing.publishedRevisionId) &&
        existing.slug !== input.slug
      ) {
        return {
          ok: false as const,
          error: "Slug sistemske ili ranije objavljene stranice ne može da se menja.",
        };
      }

      const duplicate = await db.contentPage.findFirst({
        where: { slug: input.slug, id: existing ? { not: existing.id } : undefined },
        select: { id: true },
      });
      if (duplicate) {
        return { ok: false as const, error: "Stranica sa ovim slug-om već postoji." };
      }

      if (input.intent === "publish") {
        const markdownIssues = validateCmsMarkdown(input.bodyMarkdown);
        if (markdownIssues.length) {
          return { ok: false as const, error: markdownIssues[0]!.message };
        }
      }

      const saved = await db.$transaction(async (tx) => {
        const page = existing
          ? existing
          : await tx.contentPage.create({
              data: {
                slug: input.slug,
                kind: "CUSTOM",
                template: "STANDARD",
                eyebrow: input.eyebrow || null,
                heroNote: input.heroNote || null,
                title: input.title,
                lead: input.lead || null,
                bodyMarkdown: input.bodyMarkdown,
                seoTitle: input.seoTitle || null,
                seoDescription: input.seoDescription || null,
                footerVisible: input.footerVisible,
                footerLabel: input.footerLabel || null,
                footerColumn: input.footerVisible ? input.footerColumn : null,
                footerOrder: input.footerVisible ? input.footerOrder : null,
                published: false,
              },
            });
        const latest = await tx.contentPageRevision.findFirst({
          where: { pageId: page.id },
          select: { version: true },
          orderBy: { version: "desc" },
        });
        const revision = await tx.contentPageRevision.create({
          data: {
            pageId: page.id,
            version: (latest?.version ?? 0) + 1,
            eyebrow: input.eyebrow || null,
            heroNote: input.heroNote || null,
            title: input.title,
            lead: input.lead || null,
            bodyMarkdown: input.bodyMarkdown,
            seoTitle: input.seoTitle || null,
            seoDescription: input.seoDescription || null,
            footerVisible: input.footerVisible,
            footerLabel: input.footerLabel || null,
            footerColumn: input.footerVisible ? input.footerColumn : null,
            footerOrder: input.footerVisible ? input.footerOrder : null,
            createdById: actorId,
          },
        });
        return tx.contentPage.update({
          where: { id: page.id },
          data: {
            slug: input.slug,
            eyebrow: input.eyebrow || null,
            heroNote: input.heroNote || null,
            title: input.title,
            lead: input.lead || null,
            bodyMarkdown: input.bodyMarkdown,
            seoTitle: input.seoTitle || null,
            seoDescription: input.seoDescription || null,
            footerVisible: input.footerVisible,
            footerLabel: input.footerLabel || null,
            footerColumn: input.footerVisible ? input.footerColumn : null,
            footerOrder: input.footerVisible ? input.footerOrder : null,
            draftRevisionId: revision.id,
            ...(input.intent === "publish"
              ? {
                  publishedRevisionId: revision.id,
                  published: true,
                  archivedAt: null,
                }
              : {}),
          },
          select: { id: true, slug: true, published: true },
        });
      });

      refreshContentPaths(saved.slug, input.intent === "publish");
      return {
        ok: true as const,
        entityId: saved.id,
        message:
          input.intent === "publish"
            ? "Stranica je objavljena."
            : "Nacrt je sačuvan.",
        result: { id: saved.id, created: !existing },
        diff: {
          slug: saved.slug,
          intent: input.intent,
          footerVisible: input.footerVisible,
          footerLabel: input.footerLabel,
          footerColumn: input.footerColumn,
          footerOrder: input.footerOrder,
        },
      };
    },
  )(formData);

  if (state.ok && state.result?.created) {
    redirect(`/admin/sadrzaj/${state.result.id}`);
  }
  return state;
}

export async function restoreContentRevisionAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "content-page.restore", entity: "ContentPage" },
    async (actorId, formData: FormData) => {
      const pageId = String(formData.get("pageId") ?? "");
      const revisionId = String(formData.get("revisionId") ?? "");
      if (!pageId || !revisionId) {
        return { ok: false as const, error: "Nedostaje stranica ili verzija." };
      }
      const restored = await db.$transaction(async (tx) => {
        const [page, source, latest] = await Promise.all([
          tx.contentPage.findUnique({ where: { id: pageId } }),
          tx.contentPageRevision.findFirst({ where: { id: revisionId, pageId } }),
          tx.contentPageRevision.findFirst({
            where: { pageId },
            select: { version: true },
            orderBy: { version: "desc" },
          }),
        ]);
        if (!page || !source) return null;
        const revision = await tx.contentPageRevision.create({
          data: {
            pageId,
            version: (latest?.version ?? 0) + 1,
            eyebrow: source.eyebrow,
            heroNote: source.heroNote,
            title: source.title,
            lead: source.lead,
            bodyMarkdown: source.bodyMarkdown,
            seoTitle: source.seoTitle,
            seoDescription: source.seoDescription,
            footerVisible: source.footerVisible,
            footerLabel: source.footerLabel,
            footerColumn: source.footerColumn,
            footerOrder: source.footerOrder,
            createdById: actorId,
          },
        });
        return tx.contentPage.update({
          where: { id: pageId },
          data: {
            eyebrow: source.eyebrow,
            heroNote: source.heroNote,
            title: source.title,
            lead: source.lead,
            bodyMarkdown: source.bodyMarkdown,
            seoTitle: source.seoTitle,
            seoDescription: source.seoDescription,
            footerVisible: source.footerVisible,
            footerLabel: source.footerLabel,
            footerColumn: source.footerColumn,
            footerOrder: source.footerOrder,
            draftRevisionId: revision.id,
          },
          select: { id: true, slug: true },
        });
      });
      if (!restored) return { ok: false as const, error: "Verzija nije pronađena." };
      refreshContentPaths(restored.slug, false);
      return {
        ok: true as const,
        entityId: restored.id,
        message: "Verzija je vraćena kao novi nacrt.",
        diff: { revisionId },
      };
    },
  )(formData);
}

export async function archiveContentPageAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "content-page.archive", entity: "ContentPage" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const page = await db.contentPage.findUnique({ where: { id } });
      if (!page) return { ok: false as const, error: "Stranica nije pronađena." };
      await db.contentPage.update({
        where: { id },
        data: { archivedAt: new Date(), published: false },
      });
      refreshContentPaths(page.slug, true);
      return {
        ok: true as const,
        entityId: id,
        message: "Stranica je arhivirana.",
        diff: { slug: page.slug },
      };
    },
  )(formData);
}

export async function unarchiveContentPageAction(
  _state: AdminActionState,
  formData: FormData,
) {
  return withAdminState(
    { allowed: ["CONTENT"], action: "content-page.unarchive", entity: "ContentPage" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const page = await db.contentPage.findUnique({ where: { id } });
      if (!page) return { ok: false as const, error: "Stranica nije pronađena." };
      await db.contentPage.update({ where: { id }, data: { archivedAt: null } });
      refreshContentPaths(page.slug, false);
      return {
        ok: true as const,
        entityId: id,
        message: "Stranica je vraćena među nacrte.",
        diff: { slug: page.slug },
      };
    },
  )(formData);
}

export async function deleteContentPageDraftAction(
  _state: AdminActionState,
  formData: FormData,
) {
  const state = await withAdminState(
    { allowed: ["CONTENT"], action: "content-page.deleteDraft", entity: "ContentPage" },
    async (_actorId, formData: FormData) => {
      const id = String(formData.get("id") ?? "");
      const page = await db.contentPage.findUnique({ where: { id } });
      if (!page) return { ok: false as const, error: "Stranica nije pronađena." };
      if (page.kind === "SYSTEM" || page.publishedRevisionId) {
        return {
          ok: false as const,
          error: "Može se obrisati samo prilagođeni nacrt koji nikada nije objavljen.",
        };
      }
      await db.contentPage.delete({ where: { id } });
      return {
        ok: true as const,
        entityId: id,
        message: "Nacrt je obrisan.",
        diff: { slug: page.slug },
      };
    },
  )(formData);
  if (state.ok) redirect("/admin/sadrzaj");
  return state;
}
