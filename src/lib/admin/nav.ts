import { AdminRoleName } from "@prisma/client";

export type AdminNavItem = {
  href: string;
  label: string;
  /** Roles that may see / open the page. SUPER always allowed. */
  allowed: readonly AdminRoleName[];
  description?: string;
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
    items: [
      { href: "/admin", label: "Kontrolna tabla", allowed: ALL },
    ],
  },
  {
    label: "Sadržaj",
    items: [
      { href: "/admin/pocetna", label: "Početna", allowed: C },
      { href: "/admin/sadrzaj", label: "Tekstovi", allowed: C },
      { href: "/admin/baneri", label: "Baneri", allowed: C },
      { href: "/admin/promo-traka", label: "Promo traka", allowed: C },
      { href: "/admin/tabovi", label: "Navigacija", allowed: C },
      { href: "/admin/kategorije", label: "Kategorije", allowed: C },
      { href: "/admin/piktogrami", label: "Piktogrami", allowed: C },
      { href: "/admin/erp/landing-strane", label: "Landing strane", allowed: C },
      { href: "/admin/erp/mobilni-tabovi", label: "Mobilni tabovi", allowed: C },
    ],
  },
  {
    label: "ERP",
    items: [
      { href: "/admin/erp", label: "ERP radni prostor", allowed: ALL },
      { href: "/admin/erp/artikli", label: "Artikli", allowed: CO },
      { href: "/admin/erp/dobavljaci", label: "Dobavljači i nabavka", allowed: O },
      { href: "/admin/erp/mp-cene", label: "Cene i promocije", allowed: C },
      { href: "/admin/erp/stanje-po-magacinima", label: "Zalihe i magacini", allowed: O },
      { href: "/admin/erp/prodajni-nalozi", label: "Prodajni nalozi", allowed: O },
      { href: "/admin/erp/kupci", label: "Kupci i partneri", allowed: O },
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
      { href: "/admin/fiskalizacija", label: "Fiskalizacija", allowed: O },
      { href: "/admin/checkouti", label: "Checkouti", allowed: O },
      { href: "/admin/reklamacije", label: "Reklamacije", allowed: O },
      { href: "/admin/xml-import", label: "XML feed", allowed: O },
      { href: "/admin/sistem", label: "Monitoring i backup", allowed: O },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/erp/newsletter-kampanje", label: "Newsletter", allowed: A },
      { href: "/admin/viber", label: "Viber kampanje", allowed: A },
      { href: "/admin/oglasi", label: "Oglasi (GMC/Meta)", allowed: A },
    ],
  },
  {
    label: "Analitika",
    items: [
      { href: "/admin/preporuke", label: "Preporuke kupovine", allowed: C },
      { href: "/admin/izvestaji", label: "Izveštaji", allowed: ALL },
      { href: "/admin/erp/posete-konverzije", label: "Posete i konverzije", allowed: A },
      { href: "/admin/erp/neobjavljeni-artikli", label: "QA objave", allowed: C },
      { href: "/admin/erp/matrica-zahteva", label: "Matrica ERP zahteva", allowed: ALL },
      { href: "/admin/audit-log", label: "Audit log", allowed: [] },
    ],
  },
];

export function allowedNavFor(role: AdminRoleName | null | undefined): AdminNavGroup[] {
  if (!role) return [];
  return adminNav
    .map((g) => ({
      ...g,
      items: g.items.filter((i) =>
        role === "SUPER" ? true : i.allowed.includes(role),
      ),
    }))
    .filter((g) => g.items.length > 0);
}
