/**
 * Phase 1 mock banners for the home hero carousel + editorial inserts.
 * Replaced by admin-driven CMS data in Phase 5.
 */
import type { Banner } from "@/types";

const day = 24 * 3600 * 1000;
const now = Date.now();

/**
 * Real, hotlinkable Unsplash photos used as Phase 1 hero/editorial imagery.
 * Replaced by admin-driven CMS data in Phase 5. Photos are CC0 / Unsplash license.
 */
const heroImage = (photoId: string, alt: string, w: number, h: number) => ({
  url: `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=${w}&h=${h}&q=80`,
  alt,
  width: w,
  height: h,
});

export const heroBanners: Banner[] = [
  {
    id: "hero-1",
    title: "Mesečna akcija — do 30% popusta",
    subtitle: "Kuratirana selekcija nameštaja za ceo dom. Akcija traje do kraja meseca.",
    badgeLabel: "Mesečna akcija",
    ctaLabel: "Pogledaj akciju",
    ctaHref: "/akcija",
    imageDesktop: heroImage("1586023492125-27b2c045efd7", "Mesečna akcija", 2400, 1350),
    imageMobile: heroImage("1586023492125-27b2c045efd7", "Mesečna akcija", 1080, 1350),
    startsAt: new Date(now - 5 * day).toISOString(),
    endsAt: new Date(now + 25 * day).toISOString(),
    order: 1,
  },
  {
    id: "hero-2",
    title: "Heroji meseca",
    subtitle: "Komadi koje preporučujemo — proverene kolekcije i najbolji odnos kvalitet/cena.",
    badgeLabel: "Heroji meseca",
    ctaLabel: "Otkrij heroje",
    ctaHref: "/heroji-meseca",
    imageDesktop: heroImage("1493663284031-b7e3aefcae8e", "Heroji meseca", 2400, 1350),
    imageMobile: heroImage("1493663284031-b7e3aefcae8e", "Heroji meseca", 1080, 1350),
    order: 2,
  },
  {
    id: "hero-3",
    title: "Black Friday — dok traju zalihe",
    subtitle: "Kratko traje, brzo nestaje. Dok traju zalihe.",
    badgeLabel: "Dok traju zalihe",
    ctaLabel: "Pogledaj ponudu",
    ctaHref: "/ogranicena-ponuda",
    imageDesktop: heroImage("1567016432779-094069958ea5", "Black Friday", 2400, 1350),
    imageMobile: heroImage("1567016432779-094069958ea5", "Black Friday", 1080, 1350),
    startsAt: new Date(now - 1 * day).toISOString(),
    endsAt: new Date(now + 4 * day).toISOString(),
    order: 3,
  },
];

export const editorialBanner: Banner = {
  id: "editorial-1",
  title: "Skandinavski ritam u tvojoj dnevnoj sobi",
  subtitle:
    "Topla drva, prirodne tkanine i čiste linije. Otkrij kolekciju koja prepušta prostor svetlu.",
  badgeLabel: "Specijalne ponude",
  ctaLabel: "Istraži kolekciju",
  ctaHref: "/kolekcija/skandi-dnevna",
  imageDesktop: heroImage("1583847268964-b28dc8f51f92", "Skandinavska dnevna soba", 2400, 1000),
  order: 1,
};

export const protectedPricesBanner: Banner = {
  id: "protected-prices",
  title: "Niske cene pod trajnom zaštitom",
  subtitle:
    "Posebno označeni artikli ostaju u stalnoj zaštićenoj ponudi, bez odbrojavanja i kratkih rokova.",
  badgeLabel: "Niske cene",
  ctaLabel: "Pogledaj ponudu",
  ctaHref: "/niske-cene-pod-zastitom",
  imageDesktop: {
    url: "/brand/nctz.svg",
    alt: "Niske cene pod trajnom zaštitom",
    width: 1191,
    height: 895,
  },
  order: 0,
};

export const sectionBanners: Record<string, Banner> = {
  "heroji-meseca": {
    ...heroBanners[1],
    id: "section-heroji-meseca",
    title: "Heroji meseca",
    badgeLabel: "Heroji meseca",
    ctaHref: "/heroji-meseca",
  },
  "mesecna-akcija": {
    ...heroBanners[0],
    id: "section-mesecna-akcija",
    title: "Mesečna akcija",
    badgeLabel: "Mesečna akcija",
    ctaHref: "/akcija",
  },
  "nedeljna-akcija": {
    id: "section-nedeljna-akcija",
    title: "Nedeljna akcija",
    subtitle: "Brze ponude koje se menjaju svake nedelje.",
    badgeLabel: "Nedeljna akcija",
    ctaLabel: "Pogledaj ponudu",
    ctaHref: "/nedeljna-akcija",
    imageDesktop: heroImage("1555041469-a586c61ea9bc", "Nedeljna akcija", 2400, 900),
    imageMobile: heroImage("1555041469-a586c61ea9bc", "Nedeljna akcija", 1080, 1200),
    order: 4,
  },
  "ogranicena-ponuda": {
    ...heroBanners[2],
    id: "section-ogranicena-ponuda",
    title: "Dok traju zalihe",
    badgeLabel: "Dok traju zalihe",
    ctaHref: "/ogranicena-ponuda",
  },
  "sve-do-999": {
    id: "section-sve-do-999",
    title: "Sve do 999",
    subtitle: "Pametni sitni izbori za dom, po lakoj ceni.",
    badgeLabel: "Sve do 999",
    ctaLabel: "Pogledaj artikle",
    ctaHref: "/sve-do-999",
    imageDesktop: heroImage("1513519245088-0e12902e5a38", "Sve do 999", 2400, 900),
    imageMobile: heroImage("1513519245088-0e12902e5a38", "Sve do 999", 1080, 1200),
    order: 5,
  },
  "specijalne-ponude": {
    ...editorialBanner,
    id: "section-specijalne-ponude",
    title: "Specijalne ponude",
    badgeLabel: "Specijalne ponude",
    ctaLabel: "Pogledaj ponude",
    ctaHref: "/specijalne-ponude",
  },
};
