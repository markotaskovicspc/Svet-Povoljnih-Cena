import "server-only";
import { cache } from "react";
import {
  ActionKind,
  BannerPlacement,
  HomeSectionSlotKey,
  HomeSectionSourceType,
} from "@prisma/client";
import { db, hasDatabaseConnection } from "@/lib/db";
import type { Banner, MediaAsset, Product } from "@/types";
import {
  listProducts,
  type ListProductsInput,
} from "@/lib/api/catalog";
import { protectedPricesBanner } from "@/data/banners";
import {
  hasBannerPlacementColumn,
  hasHomeSectionSlotTable,
} from "@/lib/storefront/homepage-schema";
import {
  akcijaIcon,
  herojiMesecaIcon,
  limitedCampaignSticker,
  newCampaignSticker,
  protectedPricesIcon,
  under999CampaignSticker,
  type CampaignStickerKey,
} from "@/data/campaign-icons";

type LandingPageConfig = {
  key: string;
  label: string;
  href: string;
  query: ListProductsInput;
  icon?: MediaAsset;
  campaignSticker?: CampaignStickerKey;
};

export type HomeSectionConfig = {
  slotKey: HomeSectionSlotKey;
  title: string;
  href: string;
  icon?: MediaAsset;
  campaignSticker?: CampaignStickerKey;
  products: Product[];
};

export type HomeLayout = {
  sections: Partial<Record<HomeSectionSlotKey, HomeSectionConfig>>;
  bannerAfterSecond: Banner | null;
  bannerAfterFourth: Banner | null;
};

type HomeSlotForRender = {
  slotKey: HomeSectionSlotKey;
  sourceType: HomeSectionSourceType;
  landingPageKey: string | null;
  titleOverride: string | null;
  productLimit: number;
  enabled: boolean;
  action: {
    id: string;
    slug: string;
    name: string;
    kind: ActionKind;
    startsAt: Date;
    endsAt: Date;
  } | null;
};

export const HOME_SECTION_SLOT_ORDER = [
  HomeSectionSlotKey.FIRST,
  HomeSectionSlotKey.SECOND,
  HomeSectionSlotKey.THIRD,
  HomeSectionSlotKey.FOURTH,
  HomeSectionSlotKey.FIFTH,
  HomeSectionSlotKey.SIXTH,
] as const;

export const HOME_SECTION_SLOT_LABELS: Record<HomeSectionSlotKey, string> = {
  FIRST: "Promo sekcija 1",
  SECOND: "Promo sekcija 2",
  THIRD: "Promo sekcija 3",
  FOURTH: "Promo sekcija 4",
  FIFTH: "Promo sekcija 5",
  SIXTH: "Promo sekcija 6",
};

export const LANDING_PAGE_OPTIONS: LandingPageConfig[] = [
  {
    key: "akcija",
    label: "Akcija",
    href: "/akcija",
    query: { onSaleOnly: true },
    icon: akcijaIcon,
    campaignSticker: "action",
  },
  {
    key: "nedeljna-akcija",
    label: "Nedeljna akcija",
    href: "/nedeljna-akcija",
    query: { actionSlug: "nedeljna-akcija" },
    icon: akcijaIcon,
    campaignSticker: "action",
  },
  {
    key: "heroji-meseca",
    label: "Heroji meseca",
    href: "/heroji-meseca",
    query: { heroOnly: true },
    icon: herojiMesecaIcon,
  },
  {
    key: "niske-cene-pod-zastitom",
    label: "Niske cene pod trajnom zaštitom",
    href: "/niske-cene-pod-zastitom",
    query: { actionSlug: "niske-cene-pod-zastitom" },
    icon: protectedPricesIcon,
  },
  {
    key: "ogranicena-ponuda",
    label: "Dok traju zalihe",
    href: "/ogranicena-ponuda",
    query: { limitedOnly: true },
    icon: limitedCampaignSticker,
    campaignSticker: "limited",
  },
  {
    key: "sve-do-999",
    label: "Sve do 999",
    href: "/sve-do-999",
    query: { maxPrice: 999 },
    icon: under999CampaignSticker,
    campaignSticker: "under999",
  },
  {
    key: "novo",
    label: "Novo u ponudi",
    href: "/novo",
    query: { newOnly: true },
    icon: newCampaignSticker,
    campaignSticker: "new",
  },
  {
    key: "outlet",
    label: "Outlet",
    href: "/outlet",
    query: { outletOnly: true },
    icon: akcijaIcon,
  },
  {
    key: "specijalne-ponude",
    label: "Trajno niskom cenom",
    href: "/specijalne-ponude",
    query: { actionSlug: "specijalne-ponude" },
    icon: protectedPricesIcon,
  },
];

const landingByKey = new Map(LANDING_PAGE_OPTIONS.map((page) => [page.key, page]));

const newProductsBanner: Banner = {
  id: "home-new-products",
  title: "Novo u ponudi",
  subtitle:
    "Sveže pristigli artikli za dom, odmah izdvojeni da ih lako pronađeš.",
  badgeLabel: "Novo",
  ctaLabel: "Pogledaj novo",
  ctaHref: "/novo",
  imageDesktop: newCampaignSticker,
  order: 0,
};

export const DEFAULT_HOME_SECTION_SLOTS = {
  [HomeSectionSlotKey.FIRST]: {
    slotKey: HomeSectionSlotKey.FIRST,
    sourceType: HomeSectionSourceType.LANDING_PAGE,
    landingPageKey: "heroji-meseca",
    action: null,
    titleOverride: null,
    productLimit: 12,
    enabled: true,
  },
  [HomeSectionSlotKey.SECOND]: {
    slotKey: HomeSectionSlotKey.SECOND,
    sourceType: HomeSectionSourceType.LANDING_PAGE,
    landingPageKey: "akcija",
    action: null,
    titleOverride: null,
    productLimit: 12,
    enabled: true,
  },
  [HomeSectionSlotKey.THIRD]: {
    slotKey: HomeSectionSlotKey.THIRD,
    sourceType: HomeSectionSourceType.LANDING_PAGE,
    landingPageKey: "sve-do-999",
    action: null,
    titleOverride: null,
    productLimit: 12,
    enabled: true,
  },
  [HomeSectionSlotKey.FOURTH]: {
    slotKey: HomeSectionSlotKey.FOURTH,
    sourceType: HomeSectionSourceType.LANDING_PAGE,
    landingPageKey: "ogranicena-ponuda",
    action: null,
    titleOverride: null,
    productLimit: 12,
    enabled: true,
  },
  [HomeSectionSlotKey.FIFTH]: {
    slotKey: HomeSectionSlotKey.FIFTH,
    sourceType: HomeSectionSourceType.LANDING_PAGE,
    landingPageKey: "novo",
    action: null,
    titleOverride: null,
    productLimit: 12,
    enabled: true,
  },
  [HomeSectionSlotKey.SIXTH]: {
    slotKey: HomeSectionSlotKey.SIXTH,
    sourceType: HomeSectionSourceType.LANDING_PAGE,
    landingPageKey: "outlet",
    action: null,
    titleOverride: null,
    productLimit: 12,
    enabled: false,
  },
} satisfies Record<HomeSectionSlotKey, HomeSlotForRender>;

const actionPresentation: Record<
  ActionKind,
  { href: string; icon?: MediaAsset; campaignSticker?: CampaignStickerKey }
> = {
  AKCIJA: { href: "/akcija", icon: akcijaIcon, campaignSticker: "action" },
  NEDELJNA: {
    href: "/nedeljna-akcija",
    icon: akcijaIcon,
    campaignSticker: "action",
  },
  HEROJI: { href: "/heroji-meseca", icon: herojiMesecaIcon },
  OGRANICENA: {
    href: "/ogranicena-ponuda",
    icon: limitedCampaignSticker,
    campaignSticker: "limited",
  },
  OUTLET: { href: "/outlet", icon: akcijaIcon },
  CUSTOM: { href: "/akcija", icon: akcijaIcon, campaignSticker: "action" },
};

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
    ctaHref: row.ctaHref ?? undefined,
    imageDesktop: bannerAsset(row.imageDesktop, row.title),
    imageMobile: row.imageMobile ? bannerAsset(row.imageMobile, row.title) : undefined,
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

async function getHomeBanner(placement: BannerPlacement, fallback: Banner | null) {
  if (!hasDatabaseConnection()) return fallback;
  if (!(await hasBannerPlacementColumn())) return fallback;

  try {
    const row = await db.banner.findFirst({
      where: {
        enabled: true,
        placement,
        ...activeWindow(new Date()),
      },
      orderBy: [{ order: "asc" }, { updatedAt: "desc" }],
    });

    return row ? mapBanner(row) : fallback;
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      console.error(`Failed to load homepage banner "${placement}".`, error);
    }
    return fallback;
  }
}

async function resolveSlot(slot: HomeSlotForRender) {
  if (!slot.enabled) return null;

  const limit = Math.min(Math.max(slot.productLimit || 12, 1), 24);

  if (slot.sourceType === HomeSectionSourceType.ACTION) {
    const action = slot.action;
    if (!action) return null;

    const now = Date.now();
    if (action.startsAt.getTime() > now || action.endsAt.getTime() < now) {
      return null;
    }

    const presentation = actionPresentation[action.kind];
    const products = await listProducts({ actionSlug: action.slug, limit });
    if (!products.items.length) return null;

    return {
      slotKey: slot.slotKey,
      title: slot.titleOverride?.trim() || action.name,
      href: presentation.href,
      icon: presentation.icon,
      campaignSticker: presentation.campaignSticker,
      products: products.items,
    };
  }

  const landing = slot.landingPageKey
    ? landingByKey.get(slot.landingPageKey)
    : undefined;
  if (!landing) return null;

  const products = await listProducts({ ...landing.query, limit });
  if (!products.items.length) return null;

  return {
    slotKey: slot.slotKey,
    title: slot.titleOverride?.trim() || landing.label,
    href: landing.href,
    icon: landing.icon,
    campaignSticker: landing.campaignSticker,
    products: products.items,
  };
}

export const getHomeLayout = cache(async (): Promise<HomeLayout> => {
  const [bannerAfterSecond, bannerAfterFourth] = await Promise.all([
    getHomeBanner(
      BannerPlacement.HOME_AFTER_SECOND_ROW,
      protectedPricesBanner,
    ),
    getHomeBanner(BannerPlacement.HOME_AFTER_FOURTH_ROW, newProductsBanner),
  ]);

  let slots: HomeSlotForRender[] = Object.values(DEFAULT_HOME_SECTION_SLOTS);

  if (hasDatabaseConnection() && (await hasHomeSectionSlotTable())) {
    try {
      const rows = await db.homeSectionSlot.findMany({
        include: {
          action: {
            select: {
              id: true,
              slug: true,
              name: true,
              kind: true,
              startsAt: true,
              endsAt: true,
            },
          },
        },
        orderBy: { slotKey: "asc" },
      });

      if (rows.length) {
        const rowsBySlot = new Map(rows.map((row) => [row.slotKey, row]));
        slots = HOME_SECTION_SLOT_ORDER.map(
          (slotKey) => rowsBySlot.get(slotKey) ?? DEFAULT_HOME_SECTION_SLOTS[slotKey],
        );
      }
    } catch (error) {
      if (!isMissingSchemaError(error)) {
        console.error("Failed to load homepage section slots.", error);
      }
    }
  }

  const resolved = await Promise.all(
    HOME_SECTION_SLOT_ORDER.map(async (slotKey) => [
      slotKey,
      await resolveSlot(
        slots.find((slot) => slot.slotKey === slotKey) ??
          DEFAULT_HOME_SECTION_SLOTS[slotKey],
      ),
    ] as const),
  );

  return {
    sections: Object.fromEntries(resolved.filter(([, section]) => section)),
    bannerAfterSecond,
    bannerAfterFourth,
  };
});
