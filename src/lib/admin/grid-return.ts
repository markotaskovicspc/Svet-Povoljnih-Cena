import type { SavedGridView } from "./saved-views";

const INTERNAL_ORIGIN = "https://erp.invalid";

/** Only return to the expected list, never an external URL or a detail/action. */
export function gridReturnHref(value: unknown, fallback: string) {
  if (typeof value !== "string" || value.length > 4096 ||
      !value.startsWith("/") || value.startsWith("//") || /[\\\r\n\0]/.test(value)) return fallback;
  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    const expected = new URL(fallback, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN || url.pathname !== expected.pathname) return fallback;
    url.searchParams.delete("returnTo");
    return url.pathname + url.search;
  } catch { return fallback; }
}

export function withGridReturnTo(detailHref: string, listHref: string) {
  const url = new URL(detailHref, INTERNAL_ORIGIN);
  if (url.origin !== INTERNAL_ORIGIN || !url.pathname.startsWith("/admin/")) return detailHref;
  url.searchParams.set("returnTo", listHref);
  return url.pathname + url.search + url.hash;
}

/** A changed saved definition must take precedence over an older tab snapshot. */
export function gridViewFingerprint(view: SavedGridView) {
  return JSON.stringify([
    view.id, view.query, view.searchColumn ?? "", view.filters, view.sorting,
    view.visibleColumns, view.columnOrder, view.columnWidths, view.context ?? {},
  ]);
}
