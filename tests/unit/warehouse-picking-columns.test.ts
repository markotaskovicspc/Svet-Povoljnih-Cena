import { expect, it } from "vitest";
import { migrateWarehousePickingColumns } from "@/lib/admin/warehouse-picking-columns";
import { readGridNavigation } from "@/lib/admin/grid-navigation";

it("inserts the new column after SKU without losing a legacy view's other choices", () => {
  expect(migrateWarehousePickingColumns("stanje-po-magacinima", ["sku", "physical"], ["warehouse", "sku", "physical"])).toEqual({
    visibleColumns: ["sku", "pickingPosition", "physical"],
    columnOrder: ["warehouse", "sku", "pickingPosition", "physical"],
  });
});

it("preserves a later explicit choice to hide or move picking position", () => {
  expect(migrateWarehousePickingColumns("stanje-po-magacinima", ["sku"], ["pickingPosition", "sku"])).toEqual({
    visibleColumns: ["sku"], columnOrder: ["pickingPosition", "sku"],
  });
  expect(migrateWarehousePickingColumns("artikli", ["sku"], ["sku"])).toEqual({ visibleColumns: ["sku"], columnOrder: ["sku"] });
});

it("migrates browser history before completing its column order and keeps filters and page", () => {
  const snapshot = { version: 1, query: "chair", searchColumn: "sku", filters: [], sorting: [], visibleColumns: ["sku", "physical"], columnOrder: ["warehouse", "sku", "physical"], columnWidths: {}, context: {}, page: 2 };
  expect(readGridNavigation(JSON.stringify(snapshot), ["warehouse", "sku", "pickingPosition", "physical"], "stanje-po-magacinima")).toMatchObject({
    visibleColumns: ["sku", "pickingPosition", "physical"], columnOrder: ["warehouse", "sku", "pickingPosition", "physical"], query: "chair", page: 2,
  });
  expect(readGridNavigation(JSON.stringify({ ...snapshot, visibleColumns: ["removed"] }), ["sku", "pickingPosition"], "stanje-po-magacinima")).toBeNull();
});
