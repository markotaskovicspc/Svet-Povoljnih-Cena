import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(), batch: vi.fn(), warehouse: vi.fn(), payments: vi.fn(),
  items: vi.fn(), insert: vi.fn(), update: vi.fn(), events: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: (run: (tx: unknown) => unknown) => run({
    $queryRaw: mocks.query,
    pickupBatch: { findUnique: mocks.batch, findMany: async () => [] },
    warehouse: { findFirst: mocks.warehouse },
    payment: { findMany: mocks.payments },
    orderItem: { findMany: mocks.items },
    pickupBatchLine: { createMany: mocks.insert },
    order: { updateMany: mocks.update },
    orderStatusEvent: { createMany: mocks.events },
  }),
} }));
import { loadEligibleOrders } from "@/lib/admin/pickup-batch.server";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.batch.mockResolvedValue({ id: "batch", number: "PRE-test", status: "DRAFT", provider: "X_EXPRESS" });
  mocks.warehouse.mockResolvedValue({ id: "dc" });
  mocks.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "order", number: "SPC-test", paymentMethod: "POUZECE_GOTOVINA" }]);
  mocks.payments.mockResolvedValue([{ orderId: "order", status: "PENDING" }]);
  mocks.items.mockResolvedValue([{ id: "item", orderId: "order", sku: "210006", name: "CHOP GENIE XXL", qty: 2, warehouseReservedQty: 2, withAssembly: false,
    product: { grossWeightKg: 0, weightKg: 0, unitPackWidthCm: 17, unitPackDepthCm: 17, unitPackHeightCm: 25 },
  }]);
});

it("loads both zero-weight units into X Express without inventing weight or marking them ready", async () => {
  const result = await loadEligibleOrders("batch", "actor", ["order"]);
  expect(result).toMatchObject({ orderCount: 1, lineCount: 2, skippedInvalidDimensionsCount: 0 });
  const lines = mocks.insert.mock.calls[0][0].data;
  expect(lines).toHaveLength(2);
  for (const line of lines) {
    expect(line).toMatchObject({ orderId: "order", orderItemId: "item", weightKg: null, widthCm: 17, depthCm: 17, heightCm: 25 });
    expect(line).not.toHaveProperty("warehouseReadyAt");
  }
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: { in: ["order"] }, status: "KREIRANO" }, data: { status: "U_PRIPREMI" } });
  const query = mocks.query.mock.calls[1][0];
  expect(query.text).toContain('orders."id" IN (');
  expect(query.values).toContain("order");
  expect(query.text).toContain('FROM "PickupBatchLine" AS pickup_lines');
});

it("still leaves unpaid bank-transfer orders out of picking", async () => {
  mocks.query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "order", number: "SPC-test", paymentMethod: "UPLATA_NA_RACUN" }]);
  const result = await loadEligibleOrders("batch", "actor", ["order"]);
  expect(result).toMatchObject({ orderCount: 0, skippedPaymentCount: 1 });
  expect(mocks.insert).not.toHaveBeenCalled();
});

it("does not broaden an empty explicit recovery scope to every order", async () => {
  mocks.query.mockReset().mockResolvedValue([]);
  expect(await loadEligibleOrders("batch", "actor", [])).toMatchObject({ orderCount: 0 });
  expect(mocks.query.mock.calls[1][0].text).toContain("WHERE FALSE");
  expect(mocks.insert).not.toHaveBeenCalled();
});
