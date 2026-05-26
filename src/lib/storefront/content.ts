import "server-only";
import { cache } from "react";
import { db, hasDatabaseConnection } from "@/lib/db";
import { heroBanners, editorialBanner, protectedPricesBanner, sectionBanners } from "@/data/banners";
import { headerTabs, promoBar } from "@/data/site";
import type { Banner, PromoBar, Tab } from "@/types";

const activeWindow = (now: Date) => ({
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

function bannerAsset(url: string, alt: string) {
  return { url, alt };
}

export const getActiveBanners = cache(async (): Promise<Banner[]> => {
  if (!hasDatabaseConnection()) return heroBanners;

  try {
    const rows = await db.banner.findMany({
      where: {
        enabled: true,
        ...activeWindow(new Date()),
      },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    });

    if (!rows.length) return heroBanners;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.subtitle ?? undefined,
      badgeLabel: row.ctaLabel ?? undefined,
      ctaLabel: row.ctaLabel ?? undefined,
      ctaHref: row.ctaHref ?? undefined,
      imageDesktop: bannerAsset(row.imageDesktop, row.title),
      imageMobile: row.imageMobile
        ? bannerAsset(row.imageMobile, row.title)
        : undefined,
      startsAt: row.startsAt?.toISOString(),
      endsAt: row.endsAt?.toISOString(),
      order: row.order,
    }));
  } catch (error) {
    console.error("Failed to load active banners", error);
    return heroBanners;
  }
});

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

    if (!row) return fallback;

    return {
      id: row.id,
      title: row.title,
      subtitle: row.subtitle ?? undefined,
      badgeLabel: fallback?.badgeLabel ?? row.ctaLabel ?? undefined,
      ctaLabel: row.ctaLabel ?? fallback?.ctaLabel,
      ctaHref: row.ctaHref ?? fallback?.ctaHref,
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
      ctaHref: row.ctaHref ?? protectedPricesBanner.ctaHref,
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

export const getActivePromoBar = cache(async (): Promise<PromoBar | null> => {
  if (!hasDatabaseConnection()) return promoBar;

  try {
    const row = await db.promoBar.findFirst({
      where: {
        enabled: true,
        ...activeWindow(new Date()),
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!row) return promoBar;

    return {
      id: row.id,
      enabled: row.enabled,
      text: row.text,
      href: row.href ?? undefined,
      startsAt: row.startsAt?.toISOString(),
      endsAt: row.endsAt?.toISOString(),
    };
  } catch (error) {
    console.error("Failed to load active promo bar", error);
    return promoBar;
  }
});

export const getActiveTabs = cache(async (): Promise<Tab[]> => {
  if (!hasDatabaseConnection()) return headerTabs;

  try {
    const rows = await db.tab.findMany({
      where: { enabled: true },
      orderBy: [{ order: "asc" }, { label: "asc" }],
    });

    if (!rows.length) return headerTabs;

    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      href: row.href,
      order: row.order,
      icon: row.icon ?? undefined,
    }));
  } catch (error) {
    console.error("Failed to load active tabs", error);
    return headerTabs;
  }
});
