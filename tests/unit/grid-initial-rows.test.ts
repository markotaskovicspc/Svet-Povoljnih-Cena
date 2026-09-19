import { describe, expect, it } from "vitest";
import { canReuseInitialGridRows, createInitialGridRowsReuse, isInitialErpSnapshotComplete } from "@/lib/admin/grid-initial-rows";
import type { ErpModule } from "@/lib/admin/erp";

const gridModule: ErpModule = {
  slug: "preuzimanja", number: "13", title: "Picking", description: "",
  status: "ready", commands: [], columns: [],
  rows: [{ id: "batch", values: { number: "PRE-1" } }], initialRowsComplete: true,
};
const initial = { page: 1, query: "", filters: [], sorting: [], context: {}, reloadToken: 0 };

describe("initial ERP row reuse", () => {
  it("remains safe across StrictMode effects and never reuses stale rows after filtering", () => {
    const reuse = createInitialGridRowsReuse(gridModule);
    expect(reuse(gridModule, initial)).toBe(true);
    expect(reuse(gridModule, initial)).toBe(true);
    expect(reuse(gridModule, { ...initial, query: "PRE-2" })).toBe(false);
    expect(reuse(gridModule, initial)).toBe(false);
  });
  it("fetches fresh rows after a mutation event or server refresh", () => {
    const afterMutation = createInitialGridRowsReuse(gridModule);
    expect(afterMutation(gridModule, { ...initial, reloadToken: 1 })).toBe(false);
    expect(afterMutation(gridModule, initial)).toBe(false);
    const afterRefresh = createInitialGridRowsReuse(gridModule);
    expect(afterRefresh({ ...gridModule }, initial)).toBe(false);
    expect(afterRefresh(gridModule, initial)).toBe(false);
  });
  it("uses a complete server-rendered first page without another request", () => {
    expect(canReuseInitialGridRows(gridModule, initial)).toBe(true);
    expect(canReuseInitialGridRows({ ...gridModule, rows: [] }, initial)).toBe(true);
  });
  it("fetches when the snapshot may have been truncated or requires pagination", () => {
    expect(canReuseInitialGridRows({ ...gridModule, initialRowsComplete: false }, initial)).toBe(false);
    expect(canReuseInitialGridRows({ ...gridModule, initialRowsComplete: undefined }, initial)).toBe(false);
    expect(canReuseInitialGridRows({ ...gridModule, rows: Array.from({ length: 101 }, () => gridModule.rows[0]) }, initial)).toBe(false);
  });
  it.each([
    { page: 2 }, { query: "PRE-2" }, { reloadToken: 1 }, { context: { warehouseId: "DC" } },
    { filters: [{ columnKey: "status", operator: "equals" as const, value: "Novi" }] },
    { sorting: [{ columnKey: "number", direction: "asc" as const }] },
  ])("fetches for changed criteria, saved views, and mutation refreshes: %j", (changes) => {
    expect(canReuseInitialGridRows(gridModule, { ...initial, ...changes })).toBe(false);
  });
});

describe("server snapshot completeness", () => {
  it.each(["preuzimanja", "porudzbenice", "akcije", "racunovodstveni-registri", "dobavljaci", "reklamacije-dnevnik"])("recognizes complete one-record-per-row lists: %s", (slug) => {
    expect(isInitialErpSnapshotComplete(slug, 35, 100, {})).toBe(true);
    expect(isInitialErpSnapshotComplete(slug, 100, 100, {})).toBe(false);
  });
  it.each(["artikli", "neobjavljeni-artikli", "stanje-po-magacinima", "prodajni-nalozi", "unknown"])("does not infer completeness of transformed/unknown lists: %s", (slug) => {
    expect(isInitialErpSnapshotComplete(slug, 5, 100, {})).toBe(false);
  });
  it.each([{ skip: 1 }, { query: "test" }, { warehouseId: "DC" }, { salesOrderFilters: {} }, { stocktakeArchived: true }])("does not reuse a server snapshot with different criteria: %j", (options) => {
    expect(isInitialErpSnapshotComplete("popisi", 5, 100, options)).toBe(false);
  });
});
