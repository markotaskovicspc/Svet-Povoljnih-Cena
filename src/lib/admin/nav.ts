import type { AdminRoleName } from "@prisma/client";
import {
  compareSavedViews,
  savedGridViewHref,
  savedViewMetadata,
} from "./saved-views";

import { adminNav } from "./nav-catalog";
import type { AdminNavItem, AdminNavGroup } from "./nav-catalog";
export { adminNav } from "./nav-catalog";
export type { AdminNavItem, AdminNavGroup } from "./nav-catalog";
import { canAccessAdminModule, type AdminAccessPrincipal } from "./access-policy";

export type AdminNavPreferences = {
  visibleHrefs: string[];
  order: string[];
};

export function allowedNavFor(
  roleOrPrincipal: AdminRoleName | AdminAccessPrincipal | null | undefined,
): AdminNavGroup[] {
  const principal = typeof roleOrPrincipal === "string" ? { role: roleOrPrincipal } : roleOrPrincipal;
  if (!principal?.role) return [];
  return adminNav
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => canAccessAdminModule(principal, i.href, i.allowed)),
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
  if (
    !Array.isArray(value.visibleColumns) ||
    !Array.isArray(value.columnOrder)
  ) {
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
  // Show the new order-import tab in menus saved before this feature existed.
  const importHref = "/admin/erp/porudzbina-iz-chata";
  if (byHref.has(importHref) && !preferences.order.includes(importHref)) visible.add(importHref);

  // Include warehouse tools in menus saved before those tools existed.
  for (const href of ["/admin/erp/picking-pozicije", "/admin/erp/operativci", "/admin/magacin"]) {
    if (byHref.has(href) && !preferences.order.includes(href)) visible.add(href);
  }

  // Existing menus predate saved shortcuts, and newly pinned views must appear
  // without requiring another menu save. Keep their default placement until
  // the user explicitly includes them in the menu's ordering.
  const configured = new Set(preferences.order);
  const newViews = allowedItems.filter(
    (item) => item.savedViewId && !configured.has(item.href),
  );
  const newViewHrefs = new Set(newViews.map((item) => item.href));

  const orderedHrefs = Array.from(
    new Set([
      "/admin",
      ...preferences.order,
      ...allowedItems.map((item) => item.href),
    ]),
  ).filter(
    (href) => visible.has(href) && byHref.has(href) && !newViewHrefs.has(href),
  );
  const items = orderedHrefs.flatMap((href) => {
    const item = byHref.get(href)!;
    const children = newViews.filter((view) => view.parentHref === href);
    children.forEach((view) => newViewHrefs.delete(view.href));
    return [
      // A manually positioned shortcut is independent of its original parent,
      // so collapsing that page cannot hide a shortcut moved elsewhere.
      item.savedViewId
        ? { ...item, nested: false, parentHref: undefined }
        : item,
      ...children,
    ];
  });
  items.push(
    ...newViews
      .filter((view) => newViewHrefs.has(view.href))
      .map((view) => ({ ...view, nested: false, parentHref: undefined })),
  );

  return items.length
    ? [
        {
          label: "Moj meni",
          items,
        },
      ]
    : nav;
}

/** Views already filtered by ownership, module existence and role by the caller. */
export function withSavedViewLinks(
  nav: AdminNavGroup[],
  views: Array<{
    id: string;
    name: string;
    module: string;
    columns: unknown;
    title: string;
    allowed: readonly AdminRoleName[];
  }>,
): AdminNavGroup[] {
  const links = views
    .map((view) => ({
      ...view,
      ...savedViewMetadata(view.module, view.columns),
    }))
    .filter((view) => view.showInSidebar)
    .sort(compareSavedViews);
  const remaining = new Set(links);
  const result = nav.map((group) => ({
    ...group,
    items: group.items.flatMap((item) => {
      const children = links.filter((view) => view.pagePath === item.href);
      children.forEach((view) => remaining.delete(view));
      return [
        item,
        ...children.map((view) => ({
          href: savedGridViewHref(view.module, view),
          label: view.name,
          allowed: view.allowed,
          nested: true,
          parentHref: item.href,
          savedViewId: view.id,
        })),
      ];
    }),
  }));
  if (remaining.size)
    result.push({
      label: "Moji pogledi",
      items: Array.from(remaining).map((view) => ({
        href: savedGridViewHref(view.module, view),
        label: `${view.name} · ${view.title}`,
        allowed: view.allowed,
        savedViewId: view.id,
      })),
    });
  return result;
}
