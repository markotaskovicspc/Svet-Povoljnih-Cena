import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), product: vi.fn(), warehouse: vi.fn(), queryRaw: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => unknown) => fn({
      $queryRaw: mocks.queryRaw,
      reclamation: { findUniqueOrThrow: mocks.find, update: mocks.update },
      warehouse: { findFirst: mocks.warehouse },
      product: { findUniqueOrThrow: mocks.product },
    }),
  },
}));
import { saveReclamationWarehouse } from "@/lib/admin/reclamation-fulfillment.server";

const packages = [{ weightKg: 2, widthCm: 5, depthCm: 5, heightCm: 25 }];
const input = { reclamationId: "claim-1", warehouseId: "warehouse-1", packages, actorId: "operator-1" };
const claim = {
  decision: "PRIHVACENA", resolution: "ZAMENA_ARTIKLA", productId: "product-1", sku: "SKU-1",
  quantity: 3, replacementQty: 2, pickupBatchLines: [], shipments: [],
};
const product = {
  stock: 100,
  warehouseStocks: [{ warehouseId: "warehouse-1", qty: 2 }, { warehouseId: "dc", qty: 98 }],
  orderItems: [] as Array<{ warehouseReservedQty: number; stockMovements: Array<{ qty: number }> }>,
  partnerReservations: [] as Array<{ qty: number }>,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(claim);
  mocks.warehouse.mockResolvedValue({ id: "warehouse-1", code: "MAG-002", name: "Magacin oštećene robe", isDefault: false });
  mocks.product.mockResolvedValue(product);
  mocks.update.mockResolvedValue({ id: "claim-1" });
});

it("marks a measured replacement ready only when the selected warehouse has enough stock", async () => {
  await saveReclamationWarehouse(input);
  expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  expect(mocks.product).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "product-1" } }));
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    warehouseStatus: "READY", replacementReadyAt: expect.any(Date),
    replacementReadyById: "operator-1", replacementPackages: packages,
  }) }));
});

it.each([0, 1, -1])("rejects insufficient selected warehouse stock (%i) even if other warehouses have stock", async qty => {
  mocks.product.mockResolvedValue({ ...product, warehouseStocks: [{ warehouseId: "warehouse-1", qty }, { warehouseId: "dc", qty: 100 }] });
  await expect(saveReclamationWarehouse(input)).rejects.toThrow(`potrebno 2, raspoloživo ${Math.max(qty, 0)}`);
  expect(mocks.update).not.toHaveBeenCalled();
});

it.each([{ warehouseStocks: [] }, { warehouseStocks: [{ warehouseId: "dc", qty: 100 }] }])("never borrows the aggregate for a missing non-default warehouse row (%j)", async ({ warehouseStocks }) => {
  mocks.product.mockResolvedValue({ ...product, warehouseStocks });
  await expect(saveReclamationWarehouse(input)).rejects.toThrow("MAG-002 · Magacin oštećene robe (potrebno 2, raspoloživo 0)");
  expect(mocks.update).not.toHaveBeenCalled();
});

it("subtracts pending order and partner reservations in the selected warehouse", async () => {
  mocks.product.mockResolvedValue({ ...product,
    warehouseStocks: [{ warehouseId: "warehouse-1", qty: 4 }],
    orderItems: [{ warehouseReservedQty: 2, stockMovements: [] }],
    partnerReservations: [{ qty: 1 }],
  });
  await expect(saveReclamationWarehouse(input)).rejects.toThrow("potrebno 2, raspoloživo 1");
  expect(mocks.product.mock.calls[0][0].select).toMatchObject({
    orderItems: { where: { warehouseId: "warehouse-1", warehouseReservedQty: { gt: 0 }, order: { status: { notIn: ["ISPORUCENO", "OTKAZANO", "VRACENO"] } } } },
    partnerReservations: { where: { warehouseId: "warehouse-1", status: "ACTIVE", AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }] } },
  });
  expect(mocks.update).not.toHaveBeenCalled();
});

it("does not subtract legacy reservations twice", async () => {
  mocks.product.mockResolvedValue({ ...product, orderItems: [{ warehouseReservedQty: 3, stockMovements: [{ qty: -3 }] }] });
  await expect(saveReclamationWarehouse(input)).resolves.toMatchObject({ id: "claim-1" });
});

it("uses legacy stock only for a default warehouse with no warehouse rows", async () => {
  mocks.warehouse.mockResolvedValue({ id: "warehouse-1", isDefault: true });
  mocks.product.mockResolvedValue({ ...product, stock: 2, warehouseStocks: [] });
  await expect(saveReclamationWarehouse(input)).resolves.toMatchObject({ id: "claim-1" });
  expect(mocks.product.mock.calls[0][0].select).toMatchObject({
    orderItems: { where: { OR: [{ warehouseId: "warehouse-1" }, { warehouseId: null }] } },
    partnerReservations: { where: { OR: [{ warehouseId: "warehouse-1" }, { warehouseId: null }] } },
  });
  mocks.product.mockResolvedValue({ ...product, warehouseStocks: [{ warehouseId: "other", qty: 100 }] });
  await expect(saveReclamationWarehouse(input)).rejects.toThrow("raspoloživo 0");
});

it("uses the claimed quantity for legacy replacements without replacementQty", async () => {
  mocks.find.mockResolvedValue({ ...claim, replacementQty: null });
  await expect(saveReclamationWarehouse(input)).rejects.toThrow("potrebno 3, raspoloživo 2");
  expect(mocks.update).not.toHaveBeenCalled();
});

it.each([0, -1, 1.5, 4])("rejects an invalid whole replacement quantity (%s)", async replacementQty => {
  mocks.find.mockResolvedValue({ ...claim, replacementQty });
  await expect(saveReclamationWarehouse(input)).rejects.toThrow("Količina celih zamenskih artikala nije ispravna");
  expect(mocks.update).not.toHaveBeenCalled();
});

it("rejects a whole replacement without a linked product", async () => {
  mocks.find.mockResolvedValue({ ...claim, productId: null });
  await expect(saveReclamationWarehouse(input)).rejects.toThrow("nema vezan proizvod");
  expect(mocks.update).not.toHaveBeenCalled();
});

it("does not require whole-product stock for a measured spare part", async () => {
  mocks.find.mockResolvedValue({ ...claim, resolution: "ZAMENA_DELA", replacementQty: 0, resolutionNote: "16 nogica" });
  await saveReclamationWarehouse(input);
  expect(mocks.product).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalled();
});

it("allows preparation before readiness without a stock check", async () => {
  await saveReclamationWarehouse({ ...input, status: "PREPARING" });
  expect(mocks.product).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ replacementReadyAt: null }) }));
});

it("does not mark ready without measured packages", async () => {
  await expect(saveReclamationWarehouse({ ...input, packages: undefined })).rejects.toThrow();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("does not modify replacement already loaded into picking", async () => {
  mocks.find.mockResolvedValue({ ...claim, pickupBatchLines: [{ id: "line-1" }] });
  await expect(saveReclamationWarehouse(input)).rejects.toThrow("picking");
  expect(mocks.update).not.toHaveBeenCalled();
});
