/**
 * Phase 1 mock site-level data: promo bar, header tabs, footer links, payment icons.
 * Will be replaced by admin-driven CMS data in Phase 5.
 */
import type { PromoBar, Tab } from "@/types";

export const promoBar: PromoBar = {
  id: "promo-1",
  enabled: true,
  text: "Besplatna isporuka za porudžbine preko 30.000 RSD",
  href: "/uslovi-isporuke",
  // 72h countdown demo: ends in ~48h from build time. In real life this is admin-driven.
  startsAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  endsAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
};

/** Max 4 tabs per spec. Order field controls left-to-right placement. */
export const headerTabs: Tab[] = [
  { id: "akcija", label: "Akcija", href: "/akcija", order: 1, icon: "Tag" },
  {
    id: "nedeljna-akcija",
    label: "Nedeljna akcija",
    href: "/nedeljna-akcija",
    order: 2,
    icon: "CalendarDays",
  },
  {
    id: "heroji-meseca",
    label: "Heroji meseca",
    href: "/heroji-meseca",
    order: 3,
    icon: "Crown",
  },
  {
    id: "ogranicena-ponuda",
    label: "Ograničena ponuda",
    href: "/ogranicena-ponuda",
    order: 4,
    icon: "Hourglass",
  },
];

/** Hamburger nav (mobile, also used as Hover mega-nav source later). 2–3 levels. */
export interface NavNode {
  label: string;
  href: string;
  children?: NavNode[];
}

export const primaryNav: NavNode[] = [
  {
    label: "Nameštaj",
    href: "/nameštaj",
    children: [
      {
        label: "Police",
        href: "/nameštaj/police",
        children: [
          { label: "Otvorene police", href: "/nameštaj/police/otvorene" },
          { label: "Zatvorene police", href: "/nameštaj/police/zatvorene" },
        ],
      },
      {
        label: "Ormari",
        href: "/nameštaj/ormari",
        children: [
          { label: "Garderobni ormari", href: "/nameštaj/ormari/garderobni" },
          { label: "Komode", href: "/nameštaj/ormari/komode" },
        ],
      },
      { label: "Kreveti", href: "/nameštaj/kreveti" },
      { label: "Stolovi", href: "/nameštaj/stolovi" },
      { label: "Stolice", href: "/nameštaj/stolice" },
    ],
  },
  {
    label: "Trpezarije",
    href: "/trpezarije",
  },
  {
    label: "Spavaće sobe",
    href: "/spavace-sobe",
  },
  {
    label: "Dnevne sobe",
    href: "/dnevne-sobe",
  },
  {
    label: "Outlet",
    href: "/outlet",
  },
  {
    label: "Novo",
    href: "/novo",
  },
];

export const footerColumns: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Kupovina",
    links: [
      { label: "Akcija", href: "/akcija" },
      { label: "Nedeljna akcija", href: "/nedeljna-akcija" },
      { label: "Heroji meseca", href: "/heroji-meseca" },
      { label: "Outlet", href: "/outlet" },
      { label: "Novo", href: "/novo" },
    ],
  },
  {
    title: "Pomoć",
    links: [
      { label: "Kontakt", href: "/kontakt" },
      { label: "Pomoć", href: "/pomoc" },
      { label: "Servis za kupce", href: "/servis" },
      { label: "Reklamacije", href: "/reklamacije" },
      { label: "Komentari i sugestije", href: "/komentari" },
    ],
  },
  {
    title: "Uslovi",
    links: [
      { label: "Uslovi isporuke", href: "/uslovi-isporuke" },
      { label: "Uslovi kupovine", href: "/uslovi-kupovine" },
      { label: "Politika privatnosti", href: "/politika-privatnosti" },
      { label: "O nama", href: "/o-nama" },
    ],
  },
  {
    title: "Korisnički nalog",
    links: [
      { label: "Moj nalog", href: "/nalog" },
      { label: "Moje porudžbine", href: "/nalog/porudzbine" },
      { label: "Lista želja", href: "/nalog/lista-zelja" },
      { label: "Adrese", href: "/nalog/adrese" },
    ],
  },
];

export const paymentMethods = [
  { id: "visa", label: "Visa", href: "/uslovi-kupovine#kartice" },
  { id: "master", label: "Mastercard", href: "/uslovi-kupovine#kartice" },
  { id: "dina", label: "DinaCard", href: "/uslovi-kupovine#kartice" },
  { id: "ips", label: "IPS NBS", href: "/uslovi-kupovine#ips" },
  { id: "applepay", label: "Apple Pay", href: "/uslovi-kupovine#wallet" },
  { id: "googlepay", label: "Google Pay", href: "/uslovi-kupovine#wallet" },
] as const;

export const socials = [
  { id: "fb", label: "Facebook", href: "https://facebook.com/svetpovoljnihcena" },
  { id: "ig", label: "Instagram", href: "https://instagram.com/svetpovoljnihcena" },
  { id: "tt", label: "TikTok", href: "https://tiktok.com/@svetpovoljnihcena" },
] as const;
