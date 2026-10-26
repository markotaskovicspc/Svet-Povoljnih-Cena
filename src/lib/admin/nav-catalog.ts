import type { AdminRoleName } from "@prisma/client";

export type AdminNavItem = {
  href: string;
  label: string;
  /** Roles that may see / open the page. SUPER always allowed. */
  allowed: readonly AdminRoleName[];
  description?: string;
  nested?: boolean;
  parentHref?: string;
  savedViewId?: string;
};

export type AdminNavGroup = {
  label: string;
  items: AdminNavItem[];
};

const C: AdminRoleName[] = ["CONTENT"];
const O: AdminRoleName[] = ["OPS"];
const A: AdminRoleName[] = ["ADS"];
const CO: AdminRoleName[] = ["CONTENT", "OPS"];
const ALL: AdminRoleName[] = ["CONTENT", "OPS", "ADS"];

export const adminNav: AdminNavGroup[] = [
  {
    label: "Pregled",
    items: [{ href: "/admin", label: "Kontrolna tabla", allowed: ALL }],
  },
  {
    label: "Sadržaj",
    items: [
      { href: "/admin/pocetna", label: "Početna", allowed: C },
      {
        href: "/admin/mobilna-pretraga",
        label: "Mobilna pretraga",
        allowed: C,
      },
      { href: "/admin/sadrzaj", label: "Stranice", allowed: C },
      { href: "/admin/baneri", label: "Baneri", allowed: C },
      { href: "/admin/promo-traka", label: "Promo traka", allowed: C },
      { href: "/admin/tabovi", label: "Desktop navigacija", allowed: C },
      { href: "/admin/kategorije", label: "Kategorije", allowed: C },
      { href: "/admin/atributi", label: "Atributi", allowed: C },
      { href: "/admin/piktogrami", label: "Piktogrami", allowed: C },
      {
        href: "/admin/erp/landing-strane",
        label: "Landing strane",
        allowed: C,
      },
      {
        href: "/admin/erp/mobilni-tabovi",
        label: "Mobilni prečaci",
        allowed: C,
      },
    ],
  },
  {
    label: "ERP",
    items: [
      { href: "/admin/erp", label: "ERP radni prostor", allowed: ALL },
      { href: "/admin/erp/artikli", label: "Artikli", allowed: CO },
      { href: "/admin/erp/nalepnice", label: "Nalepnice za kutije", allowed: CO },
      { href: "/admin/erp/setovi", label: "Prodajni setovi", allowed: CO },
      {
        href: "/admin/erp/dobavljaci",
        label: "Dobavljači i nabavka",
        allowed: O,
      },
      { href: "/admin/erp/akcije", label: "Cene i promocije", allowed: C },
      { href: "/admin/erp/magacini", label: "Magacini", allowed: O },
      {
        href: "/admin/erp/stanje-po-magacinima",
        label: "DC lager",
        allowed: O,
      },
      {
        href: "/admin/erp/prodajni-nalozi",
        label: "Prodajni nalozi",
        allowed: O,
      },
      { href: "/admin/erp/porudzbina-iz-chata", label: "Print screen poručivanje", allowed: O },
      { href: "/admin/erp/otpremnice", label: "Otpremnice", allowed: O },
      { href: "/admin/erp/kupci", label: "Kupci i partneri", allowed: O },
      {
        href: "/admin/erp/ananas",
        label: "Ananas — računi i promet",
        allowed: O,
      },
      {
        href: "/admin/fiskalizacija",
        label: "Fiskalizacija i refundacija",
        allowed: O,
      },
      {
        href: "/admin/erp/racunovodstveni-registri",
        label: "Knjigovodstveni izveštaji",
        allowed: O,
      },
      { href: "/admin/erp/dnevni-promet", label: "Dnevni promet", allowed: O },
      { href: "/admin/erp/kurirski-obracun", label: "Kurirski obračun", allowed: O },
      { href: "/admin/erp/sef", label: "SEF fakture", allowed: O },
      { href: "/admin/razgovori", label: "Razgovori kupaca", allowed: O },
    ],
  },
  {
    label: "Komerc",
    items: [
      { href: "/admin/dostava", label: "Pravila dostave", allowed: O },
      { href: "/admin/vauceri", label: "Vaučeri", allowed: O },
      { href: "/admin/placanje", label: "Načini plaćanja", allowed: O },
    ],
  },
  {
    label: "Operativa",
    items: [
      { href: "/admin/checkouti", label: "Checkouti", allowed: O },
      {
        href: "/admin/erp/picking-pozicije",
        label: "Picking pozicije",
        allowed: O,
      },
      {
        href: "/admin/erp/operativci",
        label: "Korisnički nalozi",
        allowed: O,
      },
      { href: "/admin/magacin", label: "Prostor za magacin", allowed: O },
      {
        href: "/admin/erp/preuzimanja",
        label: "Picking i preuzimanja",
        allowed: O,
      },
      {
        href: "/admin/erp/reklamacije-dnevnik",
        label: "Reklamacije",
        allowed: O,
      },
      {
        href: "/admin/erp/preuzimanja/povrati",
        label: "Povrati za prijem",
        allowed: O,
      },
      { href: "/admin/xml-import", label: "XML feed", allowed: O },
      { href: "/admin/sistem", label: "Monitoring i backup", allowed: O },
      { href: "/admin/erp/spcapp", label: "SPCApp API", allowed: ["SUPER"] },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/newsletter", label: "Newsletter centar", allowed: A },
      { href: "/admin/viber", label: "Viber i SMS", allowed: A },
      { href: "/admin/oglasi", label: "Oglasi (GMC/Meta)", allowed: A },
    ],
  },
  {
    label: "Analitika",
    items: [
      { href: "/admin/erp/performans-artikala", label: "Performans artikala", allowed: O },
      { href: "/admin/erp/order-bump", label: "Order bump", allowed: ["ADS", "OPS"] },
      { href: "/admin/preporuke", label: "Preporuke kupovine", allowed: C },
      { href: "/admin/izvestaji", label: "Izveštajni centar", allowed: ALL },
      {
        href: "/admin/erp/posete-konverzije",
        label: "Posete i konverzije",
        allowed: ["ADS", "OPS"],
      },
      {
        href: "/admin/erp/exit-intent",
        label: "Exit-intent ponuda",
        allowed: A,
      },
      { href: "/admin/erp/3d-ar", label: "3D i AR", allowed: A },
      {
        href: "/admin/erp/neobjavljeni-artikli",
        label: "QA objave",
        allowed: C,
      },
      { href: "/admin/audit-log", label: "Audit log", allowed: [] },
    ],
  },
];
