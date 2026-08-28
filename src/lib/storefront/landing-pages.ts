import "server-only";

import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db, hasDatabaseConnection } from "@/lib/db";
import {
  EMPTY_HERO_PICTOGRAMS,
  legacySectionsToBlocks,
  parseLandingBlocks,
  parseLandingSnapshot,
  type LandingPageSnapshot,
} from "@/lib/landing-pages/blocks";

const landingPageInclude = {
  sections: { orderBy: { position: "asc" as const } },
  pictogramPlacements: true,
  draftRevision: true,
  publishedRevision: true,
} as const;
type LandingRow = Prisma.LandingPageGetPayload<{ include: typeof landingPageInclude }>;

export type StorefrontLandingPage = {
  id: string;
  slug: string;
  snapshot: LandingPageSnapshot;
  updatedAt: Date;
};

function directSnapshot(page: LandingRow): LandingPageSnapshot {
  const parsedBlocks = parseLandingBlocks(page.blocks);
  return {
    template: "BUILDER",
    legacySectionsFallback: false,
    title: page.title,
    lead: page.lead,
    heroImageUrl: page.heroImageUrl,
    heroMobileImageUrl: page.heroMobileImageUrl,
    heroImageAlt: page.heroImageAlt,
    heroCtaLabel: page.heroCtaLabel,
    heroCtaHref: page.heroCtaHref,
    heroPictograms: {
      ...EMPTY_HERO_PICTOGRAMS,
      ...Object.fromEntries(page.pictogramPlacements.map((item) => [item.slot, item.pictogramId])),
    },
    blocks: parsedBlocks.length ? parsedBlocks : legacySectionsToBlocks(page.sections),
    productSkus: [],
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImageUrl: page.ogImageUrl,
    canonicalUrl: page.canonicalUrl,
    robotsIndex: page.robotsIndex,
    startsAt: page.startsAt?.toISOString() ?? null,
    endsAt: page.endsAt?.toISOString() ?? null,
  };
}

async function loadLandingRow(slug: string) {
  return db.landingPage.findUnique({ where: { slug }, include: landingPageInclude });
}

async function loadLandingRowById(id: string) {
  return db.landingPage.findUnique({ where: { id }, include: landingPageInclude });
}

function withinPublicationWindow(snapshot: LandingPageSnapshot, now = new Date()) {
  if (snapshot.startsAt && new Date(snapshot.startsAt) > now) return false;
  if (snapshot.endsAt && new Date(snapshot.endsAt) < now) return false;
  return true;
}

function normalizeSnapshot(
  page: LandingRow,
  source: unknown,
) {
  const parsed = parseLandingSnapshot(source);
  if (!parsed.success) return directSnapshot(page);
  if (parsed.data.legacySectionsFallback) {
    return {
      ...parsed.data,
      heroPictograms: {
        ...parsed.data.heroPictograms,
        ...Object.fromEntries(page.pictogramPlacements.map((item) => [item.slot, item.pictogramId])),
      },
      blocks: legacySectionsToBlocks(page.sections),
    };
  }
  return parsed.data;
}

function publishedLandingPage(
  page: LandingRow | null,
): StorefrontLandingPage | null {
  if (!page || page.status !== "PUBLISHED" || page.archivedAt) return null;
  const snapshot = page.publishedRevision
    ? normalizeSnapshot(page, page.publishedRevision.snapshot)
    : directSnapshot(page);
  if (!withinPublicationWindow(snapshot)) return null;
  return {
    id: page.id,
    slug: page.slug,
    snapshot,
    updatedAt: page.publishedRevision?.createdAt ?? page.publishedAt ?? page.updatedAt,
  };
}

async function loadPublishedLandingPage(slug: string): Promise<StorefrontLandingPage | null> {
  if (!hasDatabaseConnection()) return null;
  return publishedLandingPage(await loadLandingRow(slug));
}

const getPublishedLandingPageAcrossRequests = unstable_cache(
  loadPublishedLandingPage,
  ["storefront-landing-page-v2"],
  { revalidate: 60, tags: ["storefront-landing-pages"] },
);

export function getLandingPageForStorefront(slug: string) {
  return getPublishedLandingPageAcrossRequests(slug);
}

export async function getLandingPageForStorefrontById(
  id: string,
): Promise<StorefrontLandingPage | null> {
  if (!hasDatabaseConnection()) return null;
  return publishedLandingPage(await loadLandingRowById(id));
}

export async function getLandingPageForAdminPreview(slug: string): Promise<StorefrontLandingPage | null> {
  if (!hasDatabaseConnection()) return null;
  const page = await loadLandingRow(slug);
  if (!page) return null;
  const snapshot = page.draftRevision
    ? normalizeSnapshot(page, page.draftRevision.snapshot)
    : directSnapshot(page);
  return { id: page.id, slug: page.slug, snapshot, updatedAt: page.updatedAt };
}

export function isLandingSnapshotLive(snapshot: LandingPageSnapshot, now = new Date()) {
  return withinPublicationWindow(snapshot, now);
}

export async function getPublishedLandingPagesForSitemap() {
  if (!hasDatabaseConnection()) return [];
  try {
    const pages = await db.landingPage.findMany({
      where: { status: "PUBLISHED", archivedAt: null },
      include: landingPageInclude,
      orderBy: { slug: "asc" },
    });
    const now = new Date();
    return pages.flatMap((page) => {
      const snapshot = page.publishedRevision
        ? normalizeSnapshot(page, page.publishedRevision.snapshot)
        : directSnapshot(page);
      return withinPublicationWindow(snapshot, now) && snapshot.robotsIndex
        ? [{ slug: page.slug, publishedAt: page.publishedRevision?.createdAt ?? page.publishedAt ?? page.updatedAt }]
        : [];
    });
  } catch (error) {
    console.error("Failed to load landing pages for sitemap", error);
    return [];
  }
}
