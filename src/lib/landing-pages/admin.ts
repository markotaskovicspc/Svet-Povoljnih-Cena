import "server-only";

import type { Prisma } from "@prisma/client";
import {
  EMPTY_HERO_PICTOGRAMS,
  legacySectionsToBlocks,
  parseLandingBlocks,
  parseLandingSnapshot,
  type LandingPageSnapshot,
} from "./blocks";

type EditableLandingPage = Prisma.LandingPageGetPayload<{
  include: {
    draftRevision: true;
    sections: true;
    pictogramPlacements: true;
  };
}>;

export function editableLandingSnapshot(page: EditableLandingPage): LandingPageSnapshot {
  const revision = page.draftRevision ? parseLandingSnapshot(page.draftRevision.snapshot) : null;
  if (revision?.success && !revision.data.legacySectionsFallback) return revision.data;
  if (revision?.success) {
    return {
      ...revision.data,
      legacySectionsFallback: false,
      heroPictograms: {
        ...revision.data.heroPictograms,
        ...Object.fromEntries(page.pictogramPlacements.map((item) => [item.slot, item.pictogramId])),
      },
      blocks: legacySectionsToBlocks(page.sections),
    };
  }
  const parsedBlocks = parseLandingBlocks(page.blocks);
  return {
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
    seoTitle: page.seoTitle,
    seoDescription: page.seoDescription,
    ogImageUrl: page.ogImageUrl,
    canonicalUrl: page.canonicalUrl,
    robotsIndex: page.robotsIndex,
    startsAt: page.startsAt?.toISOString() ?? null,
    endsAt: page.endsAt?.toISOString() ?? null,
  };
}

export function landingAdminStatus(page: {
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
}) {
  if (page.status === "ARCHIVED") return "Arhivirano";
  if (page.status === "PUBLISHED") {
    return page.draftRevisionId !== page.publishedRevisionId
      ? "Objavljeno · nacrt ima izmene"
      : "Objavljeno";
  }
  return page.publishedRevisionId ? "Povučeno · nacrt" : "Nacrt";
}
