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
      { href: "/admin/sadrzaj", label: "Stranice", allowed: C },
      { href: "/admin/baneri", label: "Baneri", allowed: C },
      { href: "/admin/promo-traka", label: "Promo traka", allowed: C },
      { href: "/admin/tabovi", label: "Desktop navigacija", allowed: C },
      { href: "/admin/kategorije", label: "Kategorije", allowed: C },
      { href: "/admin/piktogrami", label: "Piktogrami", allowed: C },
      { href: "/admin/erp/landing-strane", label: "Landing strane", allowed: C },
      { href: "/admin/erp/mobilni-tabovi", label: "Mobilni prečaci", allowed: C },
    ],
  },
  {
    label: "ERP",
    items: [
      { href: "/admin/erp", label: "ERP radni prostor", allowed: ALL },
      { href: "/admin/erp/artikli", label: "Artikli", allowed: CO },
      { href: "/admin/erp/dobavljaci", label: "Dobavljači i nabavka", allowed: O },
      { href: "/admin/akcije", label: "Cene i promocije", allowed: C },
      { href: "/admin/erp/magacini", label: "Magacini", allowed: O },
      { href: "/admin/lager", label: "DC lager", allowed: O },
      { href: "/admin/erp/prodajni-nalozi", label: "Prodajni nalozi", allowed: O },
      { href: "/admin/erp/otpremnice", label: "Otpremnice", allowed: O },
      { href: "/admin/erp/kupci", label: "Kupci i partneri", allowed: O },
      { href: "/admin/fiskalizacija", label: "Fiskalizacija i refundacija", allowed: O },
      {
        href: "/admin/erp/racunovodstveni-registri",
        label: "Knjigovodstveni izveštaji",
        allowed: O,
      },
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
      { href: "/admin/reklamacije", label: "Reklamacije", allowed: O },
      { href: "/admin/xml-import", label: "XML feed", allowed: O },
      { href: "/admin/sistem", label: "Monitoring i backup", allowed: O },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/newsletter", label: "Newsletter", allowed: A },
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

export function activeAdminNavHref(nav: AdminNavGroup[], pathname: string) {
  return nav
    .flatMap((group) => group.items)
    .filter((item) =>
      item.href === "/admin"
        ? pathname === "/admin"
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    )
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}
