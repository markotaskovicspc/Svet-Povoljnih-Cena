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
const AO: AdminRoleName[] = ["ADS", "OPS"];
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
      { href: "/admin/baneri", label: "Baneri", allowed: C },
      { href: "/admin/promo-traka", label: "Promo traka", allowed: C },
      { href: "/admin/tabovi", label: "Tabovi", allowed: C },
      { href: "/admin/kategorije", label: "Kategorije", allowed: C },
      { href: "/admin/piktogrami", label: "Piktogrami", allowed: C },
    ],
  },
  {
    label: "Katalog",
    items: [
      { href: "/admin/proizvodi", label: "Proizvodi", allowed: CO },
      { href: "/admin/akcije", label: "Akcije", allowed: C },
      { href: "/admin/heroji", label: "Heroji meseca", allowed: C },
      { href: "/admin/preporuke", label: "Preporuke kupovine", allowed: C },
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
      { href: "/admin/erp", label: "ERP sistem", allowed: ALL },
      { href: "/admin/narudzbine", label: "Narudžbine", allowed: O },
      { href: "/admin/reklamacije", label: "Reklamacije", allowed: O },
      { href: "/admin/komentari", label: "Komentari", allowed: CO },
      { href: "/admin/xml-import", label: "XML feed", allowed: O },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/newsletter", label: "Newsletter", allowed: AO },
      { href: "/admin/viber", label: "Viber kampanje", allowed: A },
      { href: "/admin/oglasi", label: "Oglasi (GMC/Meta)", allowed: A },
    ],
  },
  {
    label: "Analitika",
    items: [
      { href: "/admin/izvestaji", label: "Izveštaji", allowed: ALL },
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
