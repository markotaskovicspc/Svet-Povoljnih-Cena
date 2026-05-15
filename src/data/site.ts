/**
 * Phase 1 mock site-level data: promo bar, header tabs, footer links, payment icons.
 * Will be replaced by admin-driven CMS data in Phase 5.
 */
import type { PromoBar, Tab } from "@/types";

export const promoBar: PromoBar = {
  id: "promo-1",
  enabled: true,
  text: "NISKE CENE POD TRAJNOM ZAŠTITOM",
  href: "/niske-cene-pod-zastitom",
  startsAt: "2026-05-01T00:00:00.000+02:00",
};

/** Commercial tabs below search. Order field controls left-to-right placement. */
export const headerTabs: Tab[] = [
  { id: "mesecna-akcija", label: "Mesečna akcija", href: "/akcija", order: 1, icon: "Tag" },
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
    label: "Ograničena količina",
    href: "/ogranicena-ponuda",
    order: 4,
    icon: "Hourglass",
  },
  {
    id: "sve-do-999",
    label: "Sve do 999",
    href: "/sve-do-999",
    order: 5,
    icon: "ShieldCheck",
  },
  {
    id: "specijalne-ponude",
    label: "Specijalne ponude",
    href: "/specijalne-ponude",
    order: 6,
    icon: "Sparkles",
  },
  {
    id: "svet-akcija-katalog",
    label: "Katalog",
    href: "/svet-akcija",
    order: 7,
    icon: "Rows3",
  },
];

/** Hamburger nav (mobile, also used as Hover mega-nav source later). 2–3 levels. */
export interface NavNode {
  label: string;
  href: string;
  children?: NavNode[];
}

const categoryHref = (...segments: string[]) => `/k/${segments.join("/")}`;

export const primaryNav: NavNode[] = [
  {
    label: "Nameštaj",
    href: categoryHref("namestaj"),
    children: [
      { label: "Baštenski nameštaj", href: categoryHref("namestaj", "bastenski-namestaj") },
      { label: "Kancelarija", href: categoryHref("namestaj", "kancelarija") },
      { label: "Trpezarija", href: categoryHref("namestaj", "trpezarija") },
      { label: "Dnevna soba", href: categoryHref("namestaj", "dnevna-soba") },
      { label: "Predsoblje", href: categoryHref("namestaj", "predsoblje") },
      { label: "Gejming", href: categoryHref("namestaj", "gejming") },
      { label: "Spavaća soba", href: categoryHref("namestaj", "spavaca-soba") },
    ],
  },
  {
    label: "Sve za kuću",
    href: categoryHref("sve-za-kucu"),
    children: [
      { label: "Bazeni", href: categoryHref("sve-za-kucu", "bazeni") },
      { label: "Alat", href: categoryHref("sve-za-kucu", "alat") },
      { label: "Rasveta", href: categoryHref("sve-za-kucu", "rasveta") },
      { label: "Čišćenje i održavanje", href: categoryHref("sve-za-kucu", "ciscenje-i-odrzavanje") },
      { label: "Dekoracija", href: categoryHref("sve-za-kucu", "dekoracija") },
      { label: "Kupatilo", href: categoryHref("sve-za-kucu", "kupatilo") },
      { label: "Tepisi", href: categoryHref("sve-za-kucu", "tepisi") },
    ],
  },
  {
    label: "Kućni aparati",
    href: categoryHref("kucni-aparati"),
    children: [
      { label: "Kafe aparati", href: categoryHref("kucni-aparati", "kafe-aparati") },
      { label: "Lepota i nega", href: categoryHref("kucni-aparati", "lepota-i-nega") },
      { label: "Hlađenje i grejanje", href: categoryHref("kucni-aparati", "hladjenje-i-grejanje") },
      { label: "Priprema hrane", href: categoryHref("kucni-aparati", "priprema-hrane") },
      { label: "Kuvanje i pečenje", href: categoryHref("kucni-aparati", "kuvanje-i-pecenje") },
      { label: "Pegle", href: categoryHref("kucni-aparati", "pegle") },
      { label: "Usisivači", href: categoryHref("kucni-aparati", "usisivaci") },
      { label: "Prečišćivači vazduha", href: categoryHref("kucni-aparati", "preciscivaci-vazduha") },
      { label: "Aparati za vodu", href: categoryHref("kucni-aparati", "aparati-za-vodu") },
    ],
  },
  {
    label: "Moda i putovanja",
    href: categoryHref("moda-i-putovanja"),
    children: [
      { label: "Ženske torbe", href: categoryHref("moda-i-putovanja", "zenske-torbe") },
      { label: "Ženske čarape", href: categoryHref("moda-i-putovanja", "zenske-carape") },
      { label: "Aksesoari", href: categoryHref("moda-i-putovanja", "aksesoari") },
      { label: "Koferi", href: categoryHref("moda-i-putovanja", "koferi") },
    ],
  },
];

export const footerColumns: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Svet Akcija",
    links: [
      { label: "O nama", href: "/o-nama" },
      { label: "Kontakt", href: "/kontakt" },
      { label: "Pomoć", href: "/pomoc" },
      { label: "Servis za kupce", href: "/servis" },
      { label: "Reklamacije", href: "/reklamacije" },
      { label: "Komentari i sugestije", href: "/komentari" },
    ],
  },
  {
    title: "Kupovina",
    links: [
      { label: "Akcija", href: "/akcija" },
      { label: "Nedeljna akcija", href: "/nedeljna-akcija" },
      { label: "Heroji meseca", href: "/heroji-meseca" },
      { label: "Niske cene pod trajnom zaštitom", href: "/niske-cene-pod-zastitom" },
      { label: "Outlet", href: "/outlet" },
      { label: "Novo", href: "/novo" },
    ],
  },
  {
    title: "Uslovi",
    links: [
      { label: "Uslovi isporuke", href: "/uslovi-isporuke" },
      { label: "Uslovi kupovine", href: "/uslovi-kupovine" },
      { label: "Politika privatnosti", href: "/politika-privatnosti" },
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
  { id: "fb", label: "Facebook", href: "https://facebook.com/svetakcija" },
  { id: "ig", label: "Instagram", href: "https://instagram.com/svetakcija" },
  { id: "tt", label: "TikTok", href: "https://tiktok.com/@svetakcija" },
] as const;
