import { AdminRoleName } from "@prisma/client";

export type AdminNavItem = {
  href: string;
  label: string;
  /** Roles that may see / open the page. SUPER always allowed. */
  allowed: readonly AdminRoleName[];
  description?: string;
  nested?: boolean;
};

export type AdminNavGroup = {
  label: string;
  items: AdminNavItem[];
};

export type AdminNavPreferences = {
  visibleHrefs: string[];
  order: string[];
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
      { href: "/admin/mobilna-pretraga", label: "Mobilna pretraga", allowed: C },
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
      { href: "/admin/erp/akcije", label: "Cene i promocije", allowed: C },
      { href: "/admin/erp/magacini", label: "Magacini", allowed: O },
      { href: "/admin/erp/stanje-po-magacinima", label: "DC lager", allowed: O },
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
      { href: "/admin/erp/preuzimanja", label: "Picking i preuzimanja", allowed: O },
      { href: "/admin/erp/reklamacije-dnevnik", label: "Reklamacije", allowed: O },
      { href: "/admin/erp/povrati", label: "Povrati", allowed: O },
      { href: "/admin/xml-import", label: "XML feed", allowed: O },
      { href: "/admin/sistem", label: "Monitoring i backup", allowed: O },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/newsletter", label: "Newsletter centar", allowed: A },
      { href: "/admin/viber", label: "Viber kampanje", allowed: A },
      { href: "/admin/oglasi", label: "Oglasi (GMC/Meta)", allowed: A },
    ],
  },
  {
    label: "Analitika",
    items: [
      { href: "/admin/preporuke", label: "Preporuke kupovine", allowed: C },
      { href: "/admin/izvestaji", label: "Izveštajni centar", allowed: ALL },
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

export type ArticleSavedViewNavLink = {
  id: string;
  name: string;
};

export function articleSavedViewHref(id: string) {
  return `/admin/erp/artikli?view=${encodeURIComponent(id)}`;
}

export function withArticleSavedViewLinks(
  nav: AdminNavGroup[],
  views: ArticleSavedViewNavLink[],
): AdminNavGroup[] {
  const cleanViews = views.filter(
    (view) => view.id.trim().length > 0 && view.name.trim().length > 0,
  );
  if (!cleanViews.length) return nav;

  return nav.map((group) => {
    const articleIndex = group.items.findIndex(
      (item) => item.href === "/admin/erp/artikli",
    );
    if (articleIndex < 0) return group;

    const article = group.items[articleIndex]!;
    const savedViewItems: AdminNavItem[] = cleanViews.map((view) => ({
      href: articleSavedViewHref(view.id),
      label: view.name.trim(),
      allowed: article.allowed,
      description: "Sačuvani pogled artikala",
      nested: true,
    }));
    return {
      ...group,
      items: [
        ...group.items.slice(0, articleIndex + 1),
        ...savedViewItems,
        ...group.items.slice(articleIndex + 1),
      ],
    };
  });
}

export function activeAdminNavHref(
  nav: AdminNavGroup[],
  pathname: string,
  search = "",
) {
  const currentSearch = new URLSearchParams(search);
  return nav
    .flatMap((group) => group.items)
    .filter((item) => {
      const [itemPath = "", itemSearch = ""] = item.href.split("?");
      if (itemSearch) {
        const expectedSearch = new URLSearchParams(itemSearch);
        return (
          pathname === itemPath &&
          Array.from(expectedSearch.entries()).every(
            ([key, value]) => currentSearch.get(key) === value,
          )
        );
      }
      return item.href === "/admin"
        ? pathname === "/admin"
        : pathname === itemPath || pathname.startsWith(`${itemPath}/`);
    })
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
}

export function adminNavPreferencesFromColumns(
  columns: unknown,
): AdminNavPreferences | null {
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) {
    return null;
  }
  const value = columns as Record<string, unknown>;
  if (!Array.isArray(value.visibleColumns) || !Array.isArray(value.columnOrder)) {
    return null;
  }
  const strings = (items: unknown[]) =>
    Array.from(
      new Set(items.filter((item): item is string => typeof item === "string")),
    );
  return {
    visibleHrefs: strings(value.visibleColumns),
    order: strings(value.columnOrder),
  };
}

export function applyAdminNavPreferences(
  nav: AdminNavGroup[],
  preferences: AdminNavPreferences | null | undefined,
): AdminNavGroup[] {
  if (!preferences) return nav;

  const allowedItems = nav.flatMap((group) => group.items);
  const byHref = new Map(allowedItems.map((item) => [item.href, item]));
  const visible = new Set(
    preferences.visibleHrefs.filter((href) => byHref.has(href)),
  );
  if (byHref.has("/admin")) visible.add("/admin");

  const orderedHrefs = Array.from(
    new Set([
      "/admin",
      ...preferences.order,
      ...allowedItems.map((item) => item.href),
    ]),
  ).filter((href) => visible.has(href) && byHref.has(href));

  return orderedHrefs.length
    ? [
        {
          label: "Moj meni",
          items: orderedHrefs.map((href) => byHref.get(href)!),
        },
      ]
    : nav;
}
