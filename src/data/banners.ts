/**
 * Phase 1 mock banners for the home hero carousel + editorial inserts.
 * Replaced by admin-driven CMS data in Phase 5.
 */
import type { Banner } from "@/types";

const day = 24 * 3600 * 1000;
const now = Date.now();

const heroImage = (label: string, w: number, h: number) => ({
  url: `https://placehold.co/${w}x${h}/1A1714/D9C9A8?text=${encodeURIComponent(label)}`,
  alt: label,
  width: w,
  height: h,
});

export const heroBanners: Banner[] = [
  {
    id: "hero-1",
    title: "Mesečna akcija — do 30% popusta",
    subtitle: "Kuratirana selekcija nameštaja za ceo dom. Akcija traje do kraja meseca.",
    ctaLabel: "Pogledaj akciju",
    ctaHref: "/akcija",
    imageDesktop: heroImage("Mesečna akcija", 2400, 1350),
    imageMobile: heroImage("Mesečna akcija", 1080, 1350),
    startsAt: new Date(now - 5 * day).toISOString(),
    endsAt: new Date(now + 25 * day).toISOString(),
    order: 1,
  },
  {
    id: "hero-2",
    title: "Heroji meseca",
    subtitle: "Komadi koje preporučujemo — proverene kolekcije i najbolji odnos kvalitet/cena.",
    ctaLabel: "Otkrij heroje",
    ctaHref: "/heroji-meseca",
    imageDesktop: heroImage("Heroji meseca", 2400, 1350),
    imageMobile: heroImage("Heroji meseca", 1080, 1350),
    order: 2,
  },
  {
    id: "hero-3",
    title: "Black Friday — ograničena ponuda",
    subtitle: "Kratko traje, brzo nestaje. Dok traju zalihe.",
    ctaLabel: "Pogledaj ponudu",
    ctaHref: "/ogranicena-ponuda",
    imageDesktop: heroImage("Black Friday", 2400, 1350),
    imageMobile: heroImage("Black Friday", 1080, 1350),
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
  ctaLabel: "Istraži kolekciju",
  ctaHref: "/kolekcija/skandi-dnevna",
  imageDesktop: {
    url: "https://placehold.co/2400x1000/3B342D/F1ECE3?text=Skandi+dnevna",
    alt: "Skandinavska dnevna soba",
    width: 2400,
    height: 1000,
  },
  order: 1,
};
