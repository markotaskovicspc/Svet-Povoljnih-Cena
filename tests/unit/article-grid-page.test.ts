import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { product: { findMany: mocks.findMany } } }));
import { selectArticleGridPage, supportsArticleGridSelection } from "@/lib/admin/article-grid-page";
const empty = { query: "", searchColumn: "", searchColumns: ["photo", "stock"], filters: [], sorting: [] };
const products = Array.from({ length: 230 }, (_, i) => ({
  id: String(i), sku: String(100000 + i), articleStatus: i % 10 === 0 ? "ARH" : "AKT",
  supplier: i % 3 === 0 ? { name: "Rabalux", integrationKey: "RABALUX" } : null,
  name: `Artikal ${i}`, shortName: null, sizeLabel: "M",
}));
beforeEach(() => { vi.clearAllMocks(); mocks.findMany.mockResolvedValue(products); });
describe("lightweight article page selection", () => {
  it("filters the complete catalog before pagination, including articles without suppliers", async () => {
    const selection = { ...empty, filters: [
      { columnKey: "supplier", operator: "not_equals" as const, value: " Rabalux " },
      { columnKey: "status", operator: "not_equals" as const, value: "ARH" },
    ] };
    expect(supportsArticleGridSelection(selection)).toBe(true);
    const expected = products.filter((p) => !p.supplier && p.articleStatus !== "ARH");
    const page = await selectArticleGridPage(selection, 100, 25);
    expect(page).toEqual({ ids: expected.slice(100, 125).map((p) => p.id), total: expected.length });
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty("warehouseStocks");
    expect(mocks.findMany.mock.calls[0][0].select).not.toHaveProperty("orderItems");
  });
  it("retains total for pages past the end and no matches", async () => {
    expect(await selectArticleGridPage(empty, 300, 25)).toEqual({ ids: [], total: 230 });
    expect(await selectArticleGridPage({ ...empty, filters: [{ columnKey: "sku", value: "missing" }] }, 0, 25)).toEqual({ ids: [], total: 0 });
  });
  it("retains literal wildcards, null values and name fallbacks", async () => {
    mocks.findMany.mockResolvedValue([{ id: "one", name: "  Čarape 100%_M  ", shortName: null, supplier: null }]);
    expect(await selectArticleGridPage({ ...empty, filters: [{ columnKey: "shortName", value: "%_m" }] }, 0, 10)).toEqual({ ids: ["one"], total: 1 });
  });
  it("sorts before taking a page using the existing Serbian locale rules", async () => {
    const selection = { ...empty, sorting: [{ columnKey: "sku", direction: "desc" as const }] };
    const expected = [...products].sort((a, b) => b.sku.localeCompare(a.sku, "sr-Latn"));
    expect((await selectArticleGridPage(selection, 10, 3)).ids).toEqual(expected.slice(10, 13).map((p) => p.id));
  });
  it("falls back for stock/category filtering, calculated sorting and broad text search", () => {
    expect(supportsArticleGridSelection({ ...empty, filters: [{ columnKey: "stock", value: "1" }] })).toBe(false);
    expect(supportsArticleGridSelection({ ...empty, sorting: [{ columnKey: "category", direction: "asc" }] })).toBe(false);
    expect(supportsArticleGridSelection({ ...empty, query: "carape" })).toBe(false);
  });
  it("preserves the existing Rabalux search predicate and SKU search before grid filtering", async () => {
    await selectArticleGridPage({ ...empty, query: "Rabalux", searchColumn: "supplierIntegrationKey", searchColumns: ["supplierIntegrationKey"] }, 0, 20);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ supplierExternalId: { not: null }, supplier: { integrationKey: { equals: "Rabalux", mode: "insensitive" } } });
  });
});
