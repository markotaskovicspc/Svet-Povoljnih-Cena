import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  warehouseStock: { findMany: vi.fn() }, purchaseOrderItem: { findMany: vi.fn() },
  product: { findMany: vi.fn() }, warehouse: { findFirst: vi.fn() },
  warehousePickingPosition: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: mocks }));
import { getErpModule } from "@/lib/admin/erp";

it("loads existing position assignments for the stock API and export rows", async () => {
  mocks.warehouseStock.findMany.mockResolvedValue([{
    id: "stock", qty: 4,
    warehouse: { id: "dc", name: "DC", isDefault: true, active: true },
    product: { id: "product", sku: "001", barcode: "0012345678905", name: "Artikal", supplierId: "supplier", supplier: null, cogs: null, partnerReservations: [], orderItems: [], availableWebManual: false, availableWholesaleManual: false, availableExportManual: false },
  }]);
  mocks.purchaseOrderItem.findMany.mockResolvedValue([]);
  mocks.product.findMany.mockResolvedValue([]);
  mocks.warehouse.findFirst.mockResolvedValue(null);
  mocks.warehousePickingPosition.findMany.mockResolvedValue([
    { warehouseId: "dc", number: 12, routeOrder: 1, skus: [], supplierIds: ["supplier"] },
  ]);
  const erpModule = await getErpModule("stanje-po-magacinima", { includeLookupOptions: false });
  expect(erpModule?.columns.find(column => column.key === "pickingPosition")).toMatchObject({ label: "Picking pozicija", defaultVisible: true });
  expect(erpModule?.rows[0].values.pickingPosition).toBe("12");
  expect(erpModule?.columns.find(column => column.key === "barcode")).toMatchObject({ label: "Bar kod", defaultVisible: true });
  expect(erpModule?.rows[0].values.barcode).toBe("0012345678905");
  expect(mocks.warehousePickingPosition.findMany).toHaveBeenCalledOnce();
  expect(mocks.warehouseStock.findMany.mock.calls[0][0].select.product.select.supplierId).toBe(true);
  expect(mocks.warehouseStock.findMany.mock.calls[0][0].select.product.select.barcode).toBe(true);
  expect(mocks.purchaseOrderItem.findMany.mock.calls[0][0].select.product.select.barcode).toBe(true);
  expect(mocks.product.findMany.mock.calls[0][0].select.barcode).toBe(true);
});
