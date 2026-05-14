import "server-only";
import { cache } from "react";
import { db, hasDatabaseConnection } from "@/lib/db";
import { heroBanners, editorialBanner } from "@/data/banners";
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
      take: 6,
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
