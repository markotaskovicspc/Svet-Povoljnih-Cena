import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gridReturnHref, gridViewFingerprint, withGridReturnTo } from "@/lib/admin/grid-return";
import { readGridNavigation } from "@/lib/admin/grid-navigation";

const state = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search) }));
import { GridReturnLink } from "@/components/admin/grid-return-link";

const list = "/admin/erp/prodajni-nalozi";
const viewUrl = list + "?channel=VP&savedView=my-view";
const view = { id: "my-view", name: "VP", query: "Marko", filters: [], sorting: [], visibleColumns: ["number"], columnOrder: ["number"], columnWidths: {}, context: { channel: "VP" } };
const snapshot = { version: 1, query: "changed", searchColumn: "number", filters: [], sorting: [], visibleColumns: ["number"], columnOrder: ["number"], columnWidths: {}, context: { channel: "VP" }, page: 4, viewFingerprint: gridViewFingerprint(view) };

beforeEach(() => { state.search = ""; });

describe("ERP return navigation", () => {
  it("carries the list view through open and edit without losing query or fragment", () => {
    const href = withGridReturnTo(list + "/order?mode=edit#items", viewUrl);
    const detail = new URL(href, "https://erp.invalid");
    expect(detail.searchParams.get("mode")).toBe("edit");
    expect(detail.hash).toBe("#items");
    expect(gridReturnHref(detail.searchParams.get("returnTo"), list)).toBe(viewUrl);
  });

  it.each([undefined, "https://evil.test" + list, "//evil.test" + list, "/\\evil.test", "/admin/erp/operativci", list + "/another-order", list + "\n", "javascript:alert(1)", "x".repeat(4097)])("rejects external, unrelated or malformed return target %s", value => {
    expect(gridReturnHref(value, list)).toBe(list);
  });

  it("returns WEB/manual/Ananas links to the saved list and leaves other breadcrumbs alone", () => {
    state.search = new URLSearchParams({ returnTo: viewUrl }).toString();
    expect(renderToStaticMarkup(<GridReturnLink href={list}>Nazad</GridReturnLink>)).toContain('href="/admin/erp/prodajni-nalozi?channel=VP&amp;savedView=my-view"');
    expect(renderToStaticMarkup(<GridReturnLink href="/admin">Admin</GridReturnLink>)).toContain('href="/admin"');
  });

  it("keeps tab page and edited filters only while the saved definition is unchanged", () => {
    expect(readGridNavigation(JSON.stringify(snapshot), ["number"], "prodajni-nalozi", gridViewFingerprint(view))).toMatchObject({ page: 4, query: "changed", context: { channel: "VP" } });
    expect(readGridNavigation(JSON.stringify(snapshot), ["number"], "prodajni-nalozi", gridViewFingerprint({ ...view, query: "new saved query" }))).toBeNull();
    expect(readGridNavigation(JSON.stringify({ ...snapshot, viewFingerprint: undefined }), ["number"], "prodajni-nalozi", gridViewFingerprint(view))).toBeNull();
  });
});
