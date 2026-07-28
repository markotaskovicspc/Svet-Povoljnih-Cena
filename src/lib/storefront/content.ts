import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { BannerPlacement } from "@prisma/client";
import { db, hasDatabaseConnection } from "@/lib/db";
import { heroBanners, editorialBanner, protectedPricesBanner, sectionBanners } from "@/data/banners";
import { headerTabs, mobileShortcutTabs, promoBar } from "@/data/site";
import type { Banner, MediaAsset, PromoBar, Tab } from "@/types";
import {
  hasBannerPlacementColumn,
  hasTabPictogramColumn,
} from "@/lib/storefront/homepage-schema";
import { normalizeStorefrontHref } from "@/lib/storefront/href";
import {
  landingPageIsLive,
  resolveMobileTabHref,
} from "@/lib/mobile-shortcuts/server";
import { isMobileShortcutIconUrl } from "@/lib/mobile-shortcuts/shared";
import { pictogramMediaAsset } from "@/data/campaign-icons";

const activeWindow = (now: Date) => ({
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

function bannerAsset(url: string, alt: string) {
  return { url, alt };
}

function mapBanner(row: {
  id: string;
  title: string;
  subtitle: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  imageDesktop: string;
  imageMobile: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  order: number;
}): Banner {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? undefined,
    badgeLabel: row.ctaLabel ?? undefined,
    ctaLabel: row.ctaLabel ?? undefined,
    ctaHref: normalizeStorefrontHref(row.ctaHref),
    imageDesktop: bannerAsset(row.imageDesktop, row.title),
    imageMobile: row.imageMobile
      ? bannerAsset(row.imageMobile, row.title)
      : undefined,
    startsAt: row.startsAt?.toISOString(),
    endsAt: row.endsAt?.toISOString(),
    order: row.order,
  };
}

function isMissingSchemaError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: string }).code === "P2021" ||
      (error as { code?: string }).code === "P2022")
  );
}

async function loadActiveBanners(): Promise<Banner[]> {
  if (!hasDatabaseConnection()) return heroBanners;
  if (!(await hasBannerPlacementColumn())) return heroBanners;

  try {
    const rows = await db.banner.findMany({
      where: {
        enabled: true,
        placement: BannerPlacement.HERO,
        ...activeWindow(new Date()),
      },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });

    if (!rows.length) {
      const configuredCount = await db.banner.count({
        where: { placement: BannerPlacement.HERO },
      });
      return configuredCount === 0 ? heroBanners : [];
    }

    return rows.map(mapBanner);
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      console.error("Failed to load active banners", error);
    }
    return heroBanners;
  }
}

const getActiveBannersAcrossRequests = unstable_cache(
  loadActiveBanners,
  ["storefront-active-banners-v1"],
  { revalidate: 60, tags: ["storefront-home"] },
);

export const getActiveBanners = cache(getActiveBannersAcrossRequests);

export async function getEditorialBanner(): Promise<Banner> {
  const banners = await getActiveBanners();
  return banners[1] ?? banners[0] ?? editorialBanner;
}

export async function getSectionBanner(sectionId: string): Promise<Banner | null> {
  const fallback = sectionBanners[sectionId] ?? null;
  if (!hasDatabaseConnection()) return fallback;

  try {
    const row = await db.banner.findFirst({
      where: {
        enabled: true,
        ctaHref: fallback?.ctaHref,
        ...activeWindow(new Date()),
      },
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
    });

    if (!row && fallback?.ctaHref) {
      const configuredCount = await db.banner.count({
        where: { ctaHref: fallback.ctaHref },
      });
      return configuredCount === 0 ? fallback : null;
    }
    if (!row) return fallback;

    return {
      id: row.id,
      title: row.title,
      subtitle: row.subtitle ?? undefined,
      badgeLabel: fallback?.badgeLabel ?? row.ctaLabel ?? undefined,
      ctaLabel: row.ctaLabel ?? fallback?.ctaLabel,
      ctaHref: normalizeStorefrontHref(row.ctaHref) ?? fallback?.ctaHref,
      imageDesktop: bannerAsset(row.imageDesktop, row.title),
      imageMobile: row.imageMobile
        ? bannerAsset(row.imageMobile, row.title)
        : fallback?.imageMobile,
      startsAt: row.startsAt?.toISOString(),
      endsAt: row.endsAt?.toISOString(),
      order: row.order,
    };
  } catch (error) {
    console.error(`Failed to load section banner "${sectionId}"`, error);
    return fallback;
  }
}

export const getProtectedPricesBanner = cache(async (): Promise<Banner> => {
  if (!hasDatabaseConnection()) return protectedPricesBanner;

  try {
    const row = await db.banner.findFirst({
      where: {
        enabled: true,
        ctaHref: "/niske-cene-pod-zastitom",
        ...activeWindow(new Date()),
      },
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
    });

    if (!row) return protectedPricesBanner;

    return {
      id: row.id,
      title: row.title,
      subtitle: row.subtitle ?? undefined,
      badgeLabel: protectedPricesBanner.badgeLabel,
      ctaLabel: row.ctaLabel ?? protectedPricesBanner.ctaLabel,
      ctaHref: normalizeStorefrontHref(row.ctaHref) ?? protectedPricesBanner.ctaHref,
      imageDesktop: protectedPricesBanner.imageDesktop,
      imageMobile: protectedPricesBanner.imageMobile,
      startsAt: row.startsAt?.toISOString(),
      endsAt: row.endsAt?.toISOString(),
      order: row.order,
    };
  } catch (error) {
    console.error("Failed to load protected prices banner", error);
    return protectedPricesBanner;
  }
});

async function loadActivePromoBar(): Promise<PromoBar | null> {
  if (!hasDatabaseConnection()) return promoBar;

  try {
    const row = await db.promoBar.findFirst({
      where: {
        enabled: true,
        ...activeWindow(new Date()),
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!row) return null;

    return {
      id: row.id,
      enabled: row.enabled,
      text: row.text,
      href: normalizeStorefrontHref(row.href),
      startsAt: row.startsAt?.toISOString(),
      endsAt: row.endsAt?.toISOString(),
    };
  } catch (error) {
    console.error("Failed to load active promo bar", error);
    return promoBar;
  }
}

const getActivePromoBarAcrossRequests = unstable_cache(
  loadActivePromoBar,
  ["storefront-active-promo-bar-v1"],
  { revalidate: 60, tags: ["storefront-home"] },
);

export const getActivePromoBar = cache(getActivePromoBarAcrossRequests);

async function loadActiveTabs(): Promise<Tab[]> {
  if (!hasDatabaseConnection()) return headerTabs;

  try {
    const supportsPictograms = await hasTabPictogramColumn();
    if (supportsPictograms) {
      const rows = await db.tab.findMany({
        where: { enabled: true },
        orderBy: [{ order: "asc" }, { label: "asc" }],
        include: { pictogram: true },
      });
      if (!rows.length) {
        const configuredCount = await db.tab.count();
        return configuredCount === 0 ? headerTabs : [];
      }
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        href: normalizeStorefrontHref(row.href) ?? row.href,
        order: row.order,
        icon: row.icon ?? undefined,
        pictogram: row.pictogram ?? undefined,
      }));
    }

    const rows = await db.tab.findMany({
      where: { enabled: true },
      orderBy: [{ order: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        href: true,
        order: true,
        icon: true,
        enabled: true,
      },
    });
    if (!rows.length) {
      const configuredCount = await db.tab.count();
      return configuredCount === 0 ? headerTabs : [];
    }
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      href: normalizeStorefrontHref(row.href) ?? row.href,
      order: row.order,
      icon: row.icon ?? undefined,
    }));
  } catch (error) {
    console.error("Failed to load active tabs", error);
    return headerTabs;
  }
}

const getActiveTabsAcrossRequests = unstable_cache(
  loadActiveTabs,
  ["storefront-active-tabs-v1"],
  { revalidate: 60, tags: ["storefront-home"] },
);

export const getActiveTabs = cache(getActiveTabsAcrossRequests);

async function loadActiveMobileTabs(): Promise<Tab[]> {
  if (!hasDatabaseConnection()) return mobileShortcutTabs;

  try {
    const rows = await db.mobileTab.findMany({
      where: { enabled: true },
      orderBy: { position: "asc" },
      take: 4,
      include: {
        action: {
          select: {
            slug: true,
            kind: true,
            startsAt: true,
            endsAt: true,
          },
        },
        landingPage: {
          select: {
            slug: true,
            status: true,
            startsAt: true,
            endsAt: true,
          },
        },
      },
    });

    if (!rows.length) {
      const configuredCount = await db.mobileTab.count();
      return configuredCount === 0 ? mobileShortcutTabs : [];
    }

    const now = new Date();
    return rows.flatMap((row) => {
      if (
        (row.action &&
          (row.action.startsAt > now || row.action.endsAt < now)) ||
        (row.landingPage && !landingPageIsLive(row.landingPage))
      ) {
        return [];
      }

      const href = resolveMobileTabHref(row);
      if (!href) return [];
      return [
        {
          id: row.id,
          label: row.label,
          href,
          order: row.position,
          icon: row.icon ?? undefined,
        },
      ];
    });
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      console.error("Failed to load active mobile shortcuts", error);
    }
    return mobileShortcutTabs;
  }
}

const getActiveMobileTabsAcrossRequests = unstable_cache(
  loadActiveMobileTabs,
  ["storefront-active-mobile-shortcuts-v1"],
  { revalidate: 60, tags: ["storefront-home"] },
);

export const getActiveMobileTabs = cache(getActiveMobileTabsAcrossRequests);

async function loadTabTitleIcon(href: string): Promise<MediaAsset | undefined> {
  if (!hasDatabaseConnection()) return undefined;
  const normalizedHref = normalizeStorefrontHref(href) ?? href;

  try {
    const mobileRows = await db.mobileTab.findMany({
      where: { enabled: true, icon: { not: null } },
      orderBy: { position: "asc" },
      include: {
        action: { select: { slug: true, kind: true } },
        landingPage: { select: { slug: true } },
      },
    });
    const mobileRow = mobileRows.find((candidate) => {
      const candidateHref = resolveMobileTabHref(candidate);
      return candidateHref
        ? (normalizeStorefrontHref(candidateHref) ?? candidateHref) === normalizedHref
        : false;
    });
    if (mobileRow?.icon && isMobileShortcutIconUrl(mobileRow.icon)) {
      const pictogram = await db.pictogram.findFirst({
        where: { iconUrl: mobileRow.icon },
      });
      return pictogramMediaAsset(pictogram ?? undefined) ?? {
        url: mobileRow.icon,
        alt: mobileRow.label,
        width: 96,
        height: 96,
      };
    }

    if (!(await hasTabPictogramColumn())) return undefined;
    const rows = await db.tab.findMany({
      where: { pictogramId: { not: null } },
      include: { pictogram: true },
      orderBy: { order: "asc" },
    });
    const row = rows.find(
      (candidate) =>
        (normalizeStorefrontHref(candidate.href) ?? candidate.href) === normalizedHref,
    );
    return pictogramMediaAsset(row?.pictogram ?? undefined);
  } catch (error) {
    console.error(`Failed to load title pictogram for "${href}"`, error);
    return undefined;
  }
}

const getTabTitleIconAcrossRequests = unstable_cache(
  loadTabTitleIcon,
  ["storefront-tab-title-icon-v2"],
  { revalidate: 60, tags: ["storefront-home"] },
);

/** Reuse a mobile-shortcut or desktop-navigation pictogram beside its destination title. */
export const getTabTitleIcon = cache(getTabTitleIconAcrossRequests);
