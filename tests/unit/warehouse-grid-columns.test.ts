import { expect, it } from "vitest";
import { migrateWarehouseGridColumns } from "@/lib/admin/warehouse-grid-columns";
import { readGridNavigation } from "@/lib/admin/grid-navigation";

it("adds barcode and picking after SKU to legacy DC views", () => {
  expect(migrateWarehouseGridColumns("stanje-po-magacinima", ["sku", "physical"], ["warehouse", "sku", "physical"])).toEqual({
    visibleColumns: ["sku", "barcode", "pickingPosition", "physical"],
    columnOrder: ["warehouse", "sku", "barcode", "pickingPosition", "physical"],
  });
});

it("adds barcode to a view that already knows picking position without unhiding picking", () => {
  expect(migrateWarehouseGridColumns("stanje-po-magacinima", ["sku"], ["pickingPosition", "sku"])).toEqual({
    visibleColumns: ["sku", "barcode"], columnOrder: ["pickingPosition", "sku", "barcode"],
  });
});

it("preserves later explicit choices to hide or move the new columns", () => {
  const visibleColumns = ["physical", "sku"];
  const columnOrder = ["pickingPosition", "physical", "barcode", "sku"];
  expect(migrateWarehouseGridColumns("stanje-po-magacinima", visibleColumns, columnOrder)).toEqual({ visibleColumns, columnOrder });
  expect(migrateWarehouseGridColumns("artikli", ["sku"], ["sku"])).toEqual({ visibleColumns: ["sku"], columnOrder: ["sku"] });
});

it("migrates browser history before completing column order and keeps filters and page", () => {
  const snapshot = { version: 1, query: "carape", searchColumn: "sku", filters: [{ id: "dc", columnKey: "warehouse", operator: "contains", value: "dc" }], sorting: [], visibleColumns: ["sku", "physical"], columnOrder: ["warehouse", "sku", "pickingPosition", "physical"], columnWidths: {}, context: {}, page: 2 };
  expect(readGridNavigation(JSON.stringify(snapshot), ["warehouse", "sku", "barcode", "pickingPosition", "physical"], "stanje-po-magacinima")).toMatchObject({
    visibleColumns: ["sku", "barcode", "physical"], columnOrder: ["warehouse", "sku", "barcode", "pickingPosition", "physical"], query: "carape", filters: snapshot.filters, page: 2,
  });
  expect(readGridNavigation(JSON.stringify({ ...snapshot, visibleColumns: ["removed"] }), ["sku", "barcode", "pickingPosition"], "stanje-po-magacinima")).toBeNull();
});
