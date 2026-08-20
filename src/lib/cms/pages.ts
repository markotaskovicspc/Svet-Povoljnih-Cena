import "server-only";
import { cache } from "react";
import type { ContentPageTemplate } from "@prisma/client";
import { db, hasDatabaseConnection } from "@/lib/db";
import {
  getSystemContentPage,
  isFunctionalContentPageSlug,
  SYSTEM_CONTENT_PAGES,
  type SystemContentPageDefinition,
} from "./system-pages";

export type CmsPageSnapshot = {
  id: string | null;
  slug: string;
  kind: "SYSTEM" | "CUSTOM";
  template: ContentPageTemplate | "STANDARD" | "FAQ";
  eyebrow: string | null;
  heroNote: string | null;
  title: string;
  lead: string | null;
  bodyMarkdown: string;
  seoTitle: string | null;
  seoDescription: string | null;
  footerVisible: boolean;
  footerLabel: string | null;
  footerColumn: "COMPANY" | "TERMS" | null;
  footerOrder: number | null;
  updatedAt: Date | null;
};

function definitionSnapshot(
  definition: SystemContentPageDefinition,
): CmsPageSnapshot {
  return {
    id: null,
    slug: definition.slug,
    kind: "SYSTEM",
    template: definition.template,
    eyebrow: definition.eyebrow,
    heroNote: definition.heroNote,
    title: definition.title,
    lead: definition.lead,
    bodyMarkdown: definition.bodyMarkdown,
    seoTitle: definition.seoTitle,
    seoDescription: definition.seoDescription,
    footerVisible: definition.footerVisible,
    footerLabel: definition.footerLabel,
    footerColumn: definition.footerColumn,
    footerOrder: definition.footerOrder,
    updatedAt: null,
  };
}

function isMissingCmsSchema(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "P2021" ||
      (error as { code?: string }).code === "P2022")
  );
}

export const getPublishedContentPage = cache(async (slug: string) => {
  const fallback = getSystemContentPage(slug);
  if (!hasDatabaseConnection()) {
    return fallback ? definitionSnapshot(fallback) : null;
  }
  try {
    const page = await db.contentPage.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        kind: true,
        template: true,
        archivedAt: true,
        published: true,
        publishedRevision: {
          select: {
            eyebrow: true,
            heroNote: true,
            title: true,
            lead: true,
            bodyMarkdown: true,
            seoTitle: true,
            seoDescription: true,
            footerVisible: true,
            footerLabel: true,
            footerColumn: true,
            footerOrder: true,
            createdAt: true,
          },
        },
      },
    });
    if (
      page &&
      !page.archivedAt &&
      page.published &&
      page.publishedRevision
    ) {
      const { createdAt, ...publishedRevision } = page.publishedRevision;
      return {
        id: page.id,
        slug: page.slug,
        kind: page.kind,
        template: page.template,
        updatedAt: createdAt,
        ...publishedRevision,
      } satisfies CmsPageSnapshot;
    }
    if (page) return null;
  } catch (error) {
    if (!isMissingCmsSchema(error)) {
      console.error(`Failed to load published CMS page "${slug}"`, error);
    }
  }
  return fallback ? definitionSnapshot(fallback) : null;
});

export async function getFunctionalContentPage(slug: string) {
  if (!isFunctionalContentPageSlug(slug)) {
    throw new Error(`CMS page "${slug}" is not registered as functional.`);
  }

  const published = await getPublishedContentPage(slug);
  if (published) return published;

  const fallback = getSystemContentPage(slug);
  if (!fallback) {
    throw new Error(`Missing functional CMS fallback for "${slug}".`);
  }
  return definitionSnapshot(fallback);
}

export async function getPublishedCustomPage(slug: string) {
  const page = await getPublishedContentPage(slug);
  return page?.kind === "CUSTOM" ? page : null;
}

export type CmsFooterState = {
  managedSlugs: Set<string>;
  links: Array<{
    slug: string;
    label: string;
    column: "COMPANY" | "TERMS";
    order: number;
  }>;
};

export async function getCmsFooterState(): Promise<CmsFooterState | null> {
  if (!hasDatabaseConnection()) return null;
  try {
    const pages = await db.contentPage.findMany({
      select: {
        slug: true,
        archivedAt: true,
        published: true,
        publishedRevision: {
          select: {
            footerVisible: true,
            footerLabel: true,
            footerColumn: true,
            footerOrder: true,
          },
        },
      },
    });
    const managedSlugs = new Set(pages.map((page) => page.slug));
    const links = pages.flatMap((page) => {
      const revision = page.publishedRevision;
      if (
        page.archivedAt ||
        !page.published ||
        !revision?.footerVisible ||
        !revision.footerLabel ||
        !revision.footerColumn
      ) {
        return [];
      }
      return [{
        slug: page.slug,
        label: revision.footerLabel,
        column: revision.footerColumn,
        order: revision.footerOrder ?? 999,
      }];
    });
    return { managedSlugs, links };
  } catch (error) {
    if (!isMissingCmsSchema(error)) {
      console.error("Failed to load CMS footer state", error);
    }
    return null;
  }
}

export async function getPublishedCustomPagesForSitemap() {
  if (!hasDatabaseConnection()) return [];
  try {
    return await db.contentPage.findMany({
      where: {
        kind: "CUSTOM",
        archivedAt: null,
        published: true,
        publishedRevisionId: { not: null },
      },
      select: { slug: true, updatedAt: true },
      orderBy: { slug: "asc" },
    });
  } catch (error) {
    if (!isMissingCmsSchema(error)) {
      console.error("Failed to load CMS sitemap pages", error);
    }
    return [];
  }
}

export type CmsSitemapState = {
  managedSlugs: Set<string>;
  publishedPages: Array<{ slug: string; publishedAt: Date }>;
};

export async function getCmsSitemapState(): Promise<CmsSitemapState | null> {
  if (!hasDatabaseConnection()) return null;
  try {
    const pages = await db.contentPage.findMany({
      select: {
        slug: true,
        archivedAt: true,
        published: true,
        publishedRevisionId: true,
        publishedRevision: { select: { createdAt: true } },
      },
      orderBy: { slug: "asc" },
    });
    return {
      managedSlugs: new Set(pages.map((page) => page.slug)),
      publishedPages: pages
        .filter(
          (page) =>
            !page.archivedAt &&
            page.published &&
            page.publishedRevisionId &&
            page.publishedRevision,
        )
        .map((page) => ({
          slug: page.slug,
          publishedAt: page.publishedRevision!.createdAt,
        })),
    };
  } catch (error) {
    if (!isMissingCmsSchema(error)) {
      console.error("Failed to load CMS sitemap state", error);
    }
    return null;
  }
}

export function systemContentFallbacks() {
  return SYSTEM_CONTENT_PAGES.map(definitionSnapshot);
}
