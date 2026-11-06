import { beforeEach, expect, it, vi } from "vitest";

const transaction = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const updateMany = vi.hoisted(() => vi.fn());
const updateManyAndReturn = vi.hoisted(() => vi.fn());
const createMany = vi.hoisted(() => vi.fn());
const recomputeIncomingStock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: transaction,
    purchaseOrder: { findMany, updateMany, updateManyAndReturn },
    purchaseOrderStatusEvent: { createMany },
  },
}));
vi.mock("@/lib/admin/incoming-stock.server", () => ({
  recomputeIncomingStockForPurchaseOrders: recomputeIncomingStock,
}));
import { setPurchaseOrdersArchived } from "@/lib/admin/purchase-order-archive.server";

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((callback) => callback({
    purchaseOrder: { findMany, updateMany, updateManyAndReturn },
    purchaseOrderStatusEvent: { createMany },
  }));
  updateMany.mockResolvedValue({ count: 2 });
  findMany.mockResolvedValue([
    { id: "one", status: "SENT" },
    { id: "two", status: "CANCELLED" },
  ]);
  updateManyAndReturn.mockResolvedValue([{ id: "one" }, { id: "two" }]);
  createMany.mockResolvedValue({ count: 2 });
  recomputeIncomingStock.mockResolvedValue(undefined);
});

it("archives selected documents and cancels them", async () => {
  expect(await setPurchaseOrdersArchived(["one", "two", "one"], true, "admin")).toBe(2);
  expect(updateManyAndReturn).toHaveBeenCalledWith({
    where: { id: { in: ["one", "two"] }, archivedAt: null },
    data: { archivedAt: expect.any(Date), status: "CANCELLED" },
    select: { id: true },
  });
  expect(createMany).toHaveBeenCalledWith({
    data: [
      {
        purchaseOrderId: "one",
        status: "CANCELLED",
        note: "Porudžbenica je arhivirana i status je promenjen u Otkazana.",
        actorId: "admin",
      },
      {
        purchaseOrderId: "two",
        status: "CANCELLED",
        note: "Porudžbenica je arhivirana.",
        actorId: "admin",
      },
    ],
  });
  expect(recomputeIncomingStock).toHaveBeenCalledWith(expect.anything(), ["one", "two"]);
});

it("restores only archived documents and preserves the original status", async () => {
  await setPurchaseOrdersArchived(["one"], false, "admin");
  expect(updateMany).toHaveBeenCalledWith({
    where: { id: { in: ["one"] }, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
  expect(updateManyAndReturn).not.toHaveBeenCalled();
  expect(createMany).not.toHaveBeenCalled();
});

it("rejects an empty selection", async () => {
  await expect(setPurchaseOrdersArchived([], true, "admin")).rejects.toThrow("Izaberite");
  expect(transaction).not.toHaveBeenCalled();
});
