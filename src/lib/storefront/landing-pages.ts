import "server-only";

import { unstable_cache } from "next/cache";
import { LandingPageStatus, Prisma } from "@prisma/client";
import { db, hasDatabaseConnection } from "@/lib/db";

const landingPageInclude = {
  sections: { orderBy: { position: "asc" as const } },
} satisfies Prisma.LandingPageInclude;

export type StorefrontLandingPage = Prisma.LandingPageGetPayload<{
  include: typeof landingPageInclude;
}>;

async function loadPublishedLandingPage(
  slug: string,
): Promise<StorefrontLandingPage | null> {
  if (!hasDatabaseConnection()) return null;
  const now = new Date();
  return db.landingPage.findFirst({
    where: {
      slug,
      status: LandingPageStatus.PUBLISHED,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    include: landingPageInclude,
  });
}

const getPublishedLandingPageAcrossRequests = unstable_cache(
  loadPublishedLandingPage,
  ["storefront-landing-page-v1"],
  { revalidate: 60, tags: ["storefront-landing-pages"] },
);

export function getLandingPageForStorefront(slug: string) {
  return getPublishedLandingPageAcrossRequests(slug);
}

export function getLandingPageForAdminPreview(slug: string) {
  if (!hasDatabaseConnection()) return null;
  return db.landingPage.findUnique({
    where: { slug },
    include: landingPageInclude,
  });
}
