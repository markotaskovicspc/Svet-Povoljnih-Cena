import type { AdminGridFilter, AdminGridSort } from "./erp";
import { ACCOUNTING_SECTION_VIEWS } from "./accounting-section";

export type SavedGridView = {
  id?: string;
  name: string;
  query: string;
  searchColumn?: string;
  filters: AdminGridFilter[];
  sorting: AdminGridSort[];
  visibleColumns: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  context?: Record<string, string>;
  showInSidebar?: boolean;
  sidebarOrder?: number;
  pagePath?: string;
  routeContext?: Record<string, string>;
};

export function viewColumns(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Only page filters belong in a shortcut: never dialog/edit IDs or arbitrary URLs.
export function savedViewLocation(
  module: string,
  path?: unknown,
  context?: unknown,
) {
  const record = viewColumns(context);
  const accounting =
    path === "/admin/erp/racunovodstveni-registri" &&
    ACCOUNTING_SECTION_VIEWS.some(
      (view) => view.moduleSlug === module && view.key === record.prikaz,
    );
  const pagePath = accounting
    ? String(path)
    : `/admin/erp/${encodeURIComponent(module)}`;
  const allowed = accounting
    ? ["prikaz"]
    : ((
        {
          artikli: ["view"],
          popisi: ["view"],
          "prodajni-nalozi": ["channel", "loyalty"],
          "racunovodstveni-registri": ["prikaz"],
          "reklamacije-dnevnik": ["status"],
          "posete-konverzije": ["range", "from", "to", "group"],
        } as Record<string, string[]>
      )[module] ?? []);
  const routeContext = Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) =>
        allowed.includes(key) &&
        typeof value === "string" &&
        value.length <= 120 &&
        (key !== "view" ||
          ["archive", "archived-articles", "rabalux-stock"].includes(value)),
    ),
  ) as Record<string, string>;
  return { pagePath, routeContext };
}

export function savedViewMetadata(module: string, columns: unknown) {
  const value = viewColumns(columns);
  return {
    showInSidebar:
      typeof value.showInSidebar === "boolean"
        ? value.showInSidebar
        : module === "artikli",
    sidebarOrder:
      typeof value.sidebarOrder === "number" &&
      Number.isFinite(value.sidebarOrder)
        ? value.sidebarOrder
        : 0,
    ...savedViewLocation(module, value.pagePath, value.routeContext),
  };
}

export function savedGridViewHref(
  module: string,
  view: {
    id: string;
    pagePath?: string;
    routeContext?: Record<string, string>;
  },
) {
  const { pagePath, routeContext } = savedViewLocation(
    module,
    view.pagePath,
    view.routeContext,
  );
  const params = new URLSearchParams(routeContext);
  params.set("savedView", view.id);
  return `${pagePath}?${params}`;
}

export function compareSavedViews(
  a: { sidebarOrder?: number; name: string },
  b: { sidebarOrder?: number; name: string },
) {
  return (
    (a.sidebarOrder ?? 0) - (b.sidebarOrder ?? 0) ||
    a.name.localeCompare(b.name, "sr")
  );
}
