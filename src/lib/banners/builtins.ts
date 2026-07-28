import { BannerPlacement, type Prisma } from "@prisma/client";
import {
  heroBanners,
  newProductsBanner,
  protectedPricesBanner,
} from "@/data/banners";
import type { Banner } from "@/types";

export const BUILT_IN_BANNER_ID_PREFIX = "built-in-banner:";

const BUILT_IN_BANNERS: Record<BannerPlacement, Banner[]> = {
  [BannerPlacement.HERO]: heroBanners,
  [BannerPlacement.HOME_AFTER_SECOND_ROW]: [protectedPricesBanner],
  [BannerPlacement.HOME_AFTER_FOURTH_ROW]: [newProductsBanner],
};

function builtInBannerId(placement: BannerPlacement, bannerId: string) {
  return `${BUILT_IN_BANNER_ID_PREFIX}${placement}:${bannerId}`;
}

function optionalDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toSeed(
  placement: BannerPlacement,
  banner: Banner,
  index: number,
): Prisma.BannerCreateManyInput {
  return {
    id: builtInBannerId(placement, banner.id),
    title: banner.title,
    subtitle: banner.subtitle ?? null,
    ctaLabel: banner.ctaLabel ?? null,
    ctaHref: banner.ctaHref ?? null,
    imageDesktop: banner.imageDesktop.url,
    imageMobile: banner.imageMobile?.url ?? null,
    startsAt: optionalDate(banner.startsAt),
    endsAt: optionalDate(banner.endsAt),
    order: Number.isFinite(banner.order) ? banner.order : index,
    enabled: true,
    placement,
  };
}

export function getBuiltInBannerSeeds(placement: BannerPlacement) {
  return BUILT_IN_BANNERS[placement].map((banner, index) =>
    toSeed(placement, banner, index),
  );
}

export function isBuiltInBannerId(value: string | null | undefined) {
  return Boolean(value?.startsWith(BUILT_IN_BANNER_ID_PREFIX));
}
