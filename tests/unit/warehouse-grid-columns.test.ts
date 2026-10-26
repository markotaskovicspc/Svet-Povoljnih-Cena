import { expect, it } from "vitest";
import { migrateWarehouseGridColumns } from "@/lib/admin/warehouse-grid-columns";
import { readGridNavigation } from "@/lib/admin/grid-navigation";

it("adds barcode and picking after SKU to legacy DC views", () => {
  expect(migrateWarehouseGridColumns("stanje-po-magacinima", ["sku", "physical"], ["warehouse", "sku", "physical"])).toEqual({
    visibleColumns: ["sku", "barcode", "pickingPosition", "physical", "firstIncomingDate", "firstIncomingQty"],
    columnOrder: ["warehouse", "sku", "barcode", "pickingPosition", "physical", "firstIncomingDate", "firstIncomingQty"],
  });
});

it("adds barcode to a view that already knows picking position without unhiding picking", () => {
  expect(migrateWarehouseGridColumns("stanje-po-magacinima", ["sku"], ["pickingPosition", "sku"])).toEqual({
    visibleColumns: ["sku", "barcode", "firstIncomingDate", "firstIncomingQty"], columnOrder: ["pickingPosition", "sku", "barcode", "firstIncomingDate", "firstIncomingQty"],
  });
});

it("preserves later explicit choices to hide or move the new columns", () => {
  const visibleColumns = ["physical", "sku"];
  const columnOrder = ["pickingPosition", "physical", "barcode", "sku", "firstIncomingDate", "firstIncomingQty"];
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

it("adds the first delivery date and quantity beside incoming in legacy views", () => {
  const columns = ["sku", "barcode", "pickingPosition", "incoming", "physical"];
  expect(migrateWarehouseGridColumns("stanje-po-magacinima", columns, columns)).toEqual({
    visibleColumns: ["sku", "barcode", "pickingPosition", "incoming", "firstIncomingDate", "firstIncomingQty", "physical"],
    columnOrder: ["sku", "barcode", "pickingPosition", "incoming", "firstIncomingDate", "firstIncomingQty", "physical"],
  });
});

it("adds first-delivery columns even when incoming is hidden, and honors later hiding", () => {
  const order = ["sku", "barcode", "pickingPosition", "incoming"];
  const migrated = migrateWarehouseGridColumns("stanje-po-magacinima", ["sku"], order);
  expect(migrated.visibleColumns).toEqual(["sku", "firstIncomingDate", "firstIncomingQty"]);
  expect(migrated.columnOrder).toEqual([...order, "firstIncomingDate", "firstIncomingQty"]);
  const later = { visibleColumns: ["sku", "incoming", "firstIncomingQty"], columnOrder: migrated.columnOrder };
  expect(migrateWarehouseGridColumns("stanje-po-magacinima", later.visibleColumns, later.columnOrder)).toEqual(later);
});
