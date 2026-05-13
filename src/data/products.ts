/**
 * Phase 1 mock product catalog. Tiny seed used by instant search and homepage rails.
 * Replaced by XML feed ingestion in Phase 4.
 */
import type { Product } from "@/types";

const day = 24 * 3600 * 1000;
const now = Date.now();
const protectedPriceAction = {
  id: "act-nctz",
  name: "NISKE CENE POD TRAJNOM ZAŠTITOM",
  startsAt: "2026-05-01T00:00:00.000+02:00",
  endsAt: "2099-12-31T23:59:59.999+01:00",
  isPermanent: true,
};

/**
 * Real, hotlinkable Unsplash photos used as Phase 1 placeholders.
 * Replaced by supplier feed images in Phase 4. Photos are CC0 / Unsplash license.
 */
const unsplash = (
  photoId: string,
  alt: string,
  w = 1200,
  h = 1500,
) => ({
  url: `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=${w}&h=${h}&q=80`,
  alt,
  width: w,
  height: h,
});

export const mockProducts: Product[] = [
  {
    sku: "BS-N2212",
    slug: "polica-bjorn-n2212",
    name: "Polica Björn N2212",
    group: "otvorene-police",
    collection: "skandi-radna-soba",
    categoryPath: ["Nameštaj", "Police", "Otvorene police"],
    description: "Otvorena polica od masivnog hrasta sa metalnim okvirom u boji grafita.",
    shortDescription: "Otvorena polica, masivan hrast + metal.",
    dimensionsCm: { w: 80, d: 32, h: 180 },
    materials: [],
    pictograms: [],
    stock: 12,
    incomingStock: 0,
    isHero: true,
    isNew: true,
    newUntil: new Date(now + 30 * day).toISOString(),
    isLimited: false,
    isDtz: true,
    fullPrice: 39990,
    salePrice: 27990,
    discountPct: 30,
    action: {
      id: "act-1",
      name: "Mesečna akcija",
      startsAt: new Date(now - 5 * day).toISOString(),
      endsAt: new Date(now + 25 * day).toISOString(),
      isHero: true,
    },
    deliveryDays: { min: 3, max: 5 },
    allowsAssembly: true,
    assemblyCities: ["Beograd", "Novi Sad", "Niš"],
    media: { images: [unsplash("1538688525198-9b88f6f53126", "Polica Björn")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "OR-G3140",
    slug: "garderobni-ormar-tora-g3140",
    name: "Garderobni ormar Tora G3140",
    group: "garderobni-ormari",
    collection: "moderna-spavaca",
    categoryPath: ["Nameštaj", "Ormari", "Garderobni ormari"],
    description: "Trokrilni ormar sa ogledalom, hrast natur.",
    dimensionsCm: { w: 150, d: 60, h: 220 },
    materials: [],
    pictograms: [],
    stock: 4,
    incomingStock: 8,
    isHero: false,
    isNew: false,
    isLimited: true,
    isDtz: false,
    fullPrice: 89990,
    salePrice: 74990,
    discountPct: 17,
    action: {
      id: "act-2",
      name: "Nedeljna akcija",
      startsAt: new Date(now - 1 * day).toISOString(),
      endsAt: new Date(now + 6 * day).toISOString(),
    },
    deliveryDays: { min: 5, max: 10 },
    allowsAssembly: true,
    assemblyCities: ["Beograd", "Novi Sad"],
    media: { images: [unsplash("1595428774223-ef52624120d2", "Ormar Tora")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "ST-D1101",
    slug: "trpezarijski-sto-dora-d1101",
    name: "Trpezarijski sto Dora D1101",
    group: "trpezarijski-stolovi",
    collection: "rustik-trpezarija",
    categoryPath: ["Nameštaj", "Stolovi", "Trpezarijski"],
    description: "Sto za 6 osoba, masiv jasena, ručni završetak.",
    dimensionsCm: { w: 180, d: 90, h: 76 },
    materials: [],
    pictograms: [],
    stock: 7,
    incomingStock: 3,
    isHero: true,
    isNew: false,
    isLimited: false,
    isDtz: false,
    fullPrice: 119990,
    salePrice: 99990,
    discountPct: 17,
    action: protectedPriceAction,
    deliveryDays: { min: 7, max: 14 },
    allowsAssembly: true,
    assemblyCities: ["Beograd", "Novi Sad", "Niš", "Kragujevac"],
    media: { images: [unsplash("1505693416388-ac5ce068fe85", "Trpezarijski sto Dora")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "SC-K0401",
    slug: "stolica-kira-k0401",
    name: "Stolica Kira K0401",
    group: "trpezarijske-stolice",
    collection: "rustik-trpezarija",
    categoryPath: ["Nameštaj", "Stolice", "Trpezarijske"],
    description: "Stolica sa tapaciranim sedištem, hrast natur.",
    dimensionsCm: { w: 45, d: 50, h: 90 },
    materials: [],
    pictograms: [],
    stock: 32,
    incomingStock: 0,
    isHero: false,
    isNew: true,
    newUntil: new Date(now + 14 * day).toISOString(),
    isLimited: false,
    isDtz: false,
    fullPrice: 14990,
    salePrice: 11990,
    discountPct: 20,
    action: protectedPriceAction,
    deliveryDays: { min: 3, max: 5 },
    allowsAssembly: false,
    assemblyCities: [],
    media: { images: [unsplash("1549497538-303791108f95", "Stolica Kira")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "KR-L1801",
    slug: "krevet-lina-l1801",
    name: "Krevet Lina L1801 160×200",
    group: "kreveti",
    collection: "moderna-spavaca",
    categoryPath: ["Nameštaj", "Kreveti", "Bračni"],
    description: "Tapacirani bračni krevet, lan boja peska.",
    dimensionsCm: { w: 165, d: 215, h: 110 },
    materials: [],
    pictograms: [],
    stock: 9,
    incomingStock: 6,
    isHero: false,
    isNew: false,
    isLimited: false,
    isDtz: false,
    fullPrice: 89990,
    salePrice: 69990,
    discountPct: 22,
    action: {
      id: "act-3",
      name: "Black Friday",
      startsAt: new Date(now - 1 * day).toISOString(),
      endsAt: new Date(now + 4 * day).toISOString(),
      isHero: true,
    },
    deliveryDays: { min: 5, max: 10 },
    allowsAssembly: true,
    assemblyCities: ["Beograd", "Novi Sad"],
    media: { images: [unsplash("1505693314120-0d443867891c", "Krevet Lina")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "FT-S0902",
    slug: "fotelja-sven-s0902",
    name: "Fotelja Sven S0902",
    group: "fotelje",
    collection: "skandi-dnevna",
    categoryPath: ["Nameštaj", "Fotelje", "Tapacirane"],
    description: "Tapacirana fotelja sa drvenim nogama, boucle tkanina.",
    dimensionsCm: { w: 78, d: 82, h: 92 },
    materials: [],
    pictograms: [],
    stock: 6,
    incomingStock: 4,
    isHero: true,
    isNew: false,
    isLimited: false,
    isDtz: false,
    fullPrice: 49990,
    salePrice: 39990,
    discountPct: 20,
    action: {
      id: "act-1",
      name: "Mesečna akcija",
      startsAt: new Date(now - 5 * day).toISOString(),
      endsAt: new Date(now + 25 * day).toISOString(),
      isHero: true,
    },
    deliveryDays: { min: 5, max: 7 },
    allowsAssembly: false,
    assemblyCities: [],
    media: { images: [unsplash("1567538096630-e0c55bd6374c", "Fotelja Sven")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "KM-K2207",
    slug: "komoda-mira-k2207",
    name: "Komoda Mira K2207",
    group: "komode",
    collection: "moderna-spavaca",
    categoryPath: ["Nameštaj", "Ormari", "Komode"],
    description: "Komoda sa pet fioka, hrast natur, mat lak.",
    dimensionsCm: { w: 120, d: 45, h: 90 },
    materials: [],
    pictograms: [],
    stock: 3,
    incomingStock: 0,
    isHero: false,
    isNew: false,
    isLimited: true,
    isDtz: true,
    fullPrice: 54990,
    salePrice: 41990,
    discountPct: 24,
    action: {
      id: "act-1",
      name: "Mesečna akcija",
      startsAt: new Date(now - 5 * day).toISOString(),
      endsAt: new Date(now + 25 * day).toISOString(),
      isHero: true,
    },
    deliveryDays: { min: 5, max: 10 },
    allowsAssembly: true,
    assemblyCities: ["Beograd", "Novi Sad"],
    media: { images: [unsplash("1556228720-195a672e8a03", "Komoda Mira")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "TV-T1815",
    slug: "tv-komoda-talo-t1815",
    name: "TV komoda Talo T1815",
    group: "tv-komode",
    collection: "skandi-dnevna",
    categoryPath: ["Nameštaj", "Dnevna soba", "TV komode"],
    description: "TV komoda sa tri fioke, hrast natur + mat crna.",
    dimensionsCm: { w: 180, d: 40, h: 45 },
    materials: [],
    pictograms: [],
    stock: 18,
    incomingStock: 6,
    isHero: false,
    isNew: false,
    isLimited: false,
    isDtz: false,
    fullPrice: 44990,
    salePrice: 35990,
    discountPct: 20,
    action: {
      id: "act-2",
      name: "Nedeljna akcija",
      startsAt: new Date(now - 1 * day).toISOString(),
      endsAt: new Date(now + 6 * day).toISOString(),
    },
    deliveryDays: { min: 3, max: 7 },
    allowsAssembly: true,
    assemblyCities: ["Beograd", "Novi Sad", "Niš"],
    media: { images: [unsplash("1558211583-d26f610c1eb1", "TV komoda Talo")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "PL-N0303",
    slug: "noćni-stočić-pino-n0303",
    name: "Noćni stočić Pino N0303",
    group: "nocni-stocici",
    collection: "moderna-spavaca",
    categoryPath: ["Nameštaj", "Spavaća soba", "Noćni stočići"],
    description: "Noćni stočić sa fiokom i otvorenom policom, hrast natur.",
    dimensionsCm: { w: 45, d: 35, h: 50 },
    materials: [],
    pictograms: [],
    stock: 24,
    incomingStock: 12,
    isHero: false,
    isNew: true,
    newUntil: new Date(now + 21 * day).toISOString(),
    isLimited: false,
    isDtz: false,
    fullPrice: 12990,
    salePrice: 9990,
    discountPct: 23,
    action: {
      id: "act-2",
      name: "Nedeljna akcija",
      startsAt: new Date(now - 1 * day).toISOString(),
      endsAt: new Date(now + 6 * day).toISOString(),
    },
    deliveryDays: { min: 3, max: 5 },
    allowsAssembly: false,
    assemblyCities: [],
    media: { images: [unsplash("1505691938895-1758d7feb511", "Noćni stočić Pino")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
  {
    sku: "GR-V1206",
    slug: "garnitura-vera-v1206",
    name: "Garnitura Vera V1206",
    group: "garniture",
    collection: "skandi-dnevna",
    categoryPath: ["Nameštaj", "Dnevna soba", "Garniture"],
    description: "Trosed + dvosed, mekana boucle tkanina, drvene noge.",
    dimensionsCm: { w: 240, d: 95, h: 88 },
    materials: [],
    pictograms: [],
    stock: 2,
    incomingStock: 0,
    isHero: true,
    isNew: false,
    isLimited: true,
    isDtz: true,
    fullPrice: 199990,
    salePrice: 149990,
    discountPct: 25,
    action: {
      id: "act-3",
      name: "Black Friday",
      startsAt: new Date(now - 1 * day).toISOString(),
      endsAt: new Date(now + 4 * day).toISOString(),
      isHero: true,
    },
    deliveryDays: { min: 7, max: 14 },
    allowsAssembly: true,
    assemblyCities: ["Beograd", "Novi Sad"],
    media: { images: [unsplash("1555041469-a586c61ea9bc", "Garnitura Vera")] },
    recommendedSkus: [],
    frequentlyBoughtSkus: [],
  },
];

/** Selectors used by the home page rails. Stable, small, dependency-free. */
const byActionName = (name: string) =>
  mockProducts.filter((p) => p.action?.name === name);

export const heroesOfTheMonth = () =>
  mockProducts.filter((p) => p.isHero).slice(0, 8);

export const monthlyAction = () => byActionName("Mesečna akcija");

export const weeklyAction = () => byActionName("Nedeljna akcija");

export const protectedPrices = () =>
  mockProducts.filter((p) => p.action?.isPermanent);

/** Per-tab grouping for "Ostali tabovi" section. */
export const productsForTab = (tabId: string) => {
  switch (tabId) {
    case "akcija":
      return mockProducts.filter((p) => !!p.action);
    case "nedeljna-akcija":
      return weeklyAction();
    case "heroji-meseca":
      return heroesOfTheMonth();
    case "niske-cene-pod-zastitom":
      return protectedPrices();
    case "ogranicena-ponuda":
      return mockProducts.filter((p) => p.isLimited);
    default:
      return [];
  }
};

export interface SearchHit {
  sku: string;
  slug: string;
  name: string;
  breadcrumb: string;
  thumbnailUrl: string;
  fullPrice: number;
  salePrice: number;
  discountPct: number;
  isHero: boolean;
}

/** Lightweight client-side search used by the header instant-search. */
export function searchProducts(query: string, limit = 6): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  const matches = mockProducts.filter((p) => {
    const hay = `${p.name} ${p.sku} ${p.categoryPath.join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
  matches.sort((a, b) => {
    if ((b.isHero ? 1 : 0) !== (a.isHero ? 1 : 0)) {
      return (b.isHero ? 1 : 0) - (a.isHero ? 1 : 0);
    }
    if ((b.discountPct ?? 0) !== (a.discountPct ?? 0)) {
      return (b.discountPct ?? 0) - (a.discountPct ?? 0);
    }
    return (a.salePrice ?? a.fullPrice) - (b.salePrice ?? b.fullPrice);
  });
  return matches.slice(0, limit).map((p) => ({
    sku: p.sku,
    slug: p.slug,
    name: p.name,
    breadcrumb: p.categoryPath.join(" / "),
    thumbnailUrl: p.media.images[0]?.url ?? "",
    fullPrice: p.fullPrice,
    salePrice: p.salePrice ?? p.fullPrice,
    discountPct: p.discountPct ?? 0,
    isHero: !!p.isHero,
  }));
}
