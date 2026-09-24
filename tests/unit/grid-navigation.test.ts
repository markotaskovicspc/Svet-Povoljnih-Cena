import { expect, it } from "vitest";
import { readGridNavigation } from "@/lib/admin/grid-navigation";
const snapshot = { version: 1, query: "Marko", searchColumn: "name", filters: [{ id: "f", columnKey: "status", operator: "equals", value: "U_PRIPREMI" }], sorting: [{ columnKey: "name", direction: "asc" }], visibleColumns: ["status", "name"], columnOrder: ["status", "name"], columnWidths: { name: 180 }, context: { warehouseId: "w1" }, page: 4 };
it("restores page, filters, sort and column layout together", () => {
  expect(readGridNavigation(JSON.stringify(snapshot), ["name", "status"])).toEqual(snapshot);
});
it("ignores removed columns without losing the remaining view", () => {
  const saved = readGridNavigation(JSON.stringify(snapshot), ["name", "sku"]);
  expect(saved).toMatchObject({ page: 4, filters: [], visibleColumns: ["name"], columnOrder: ["name", "sku"] });
});
it.each([null, "broken", "{}", JSON.stringify({ ...snapshot, page: -1 }), JSON.stringify({ ...snapshot, version: 9 })])("falls back safely on invalid stored state", raw => {
  expect(readGridNavigation(raw, ["name", "status"])).toBeNull();
});
