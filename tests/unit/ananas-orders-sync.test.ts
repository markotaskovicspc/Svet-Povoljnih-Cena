import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  orders: vi.fn(), shipments: vi.fn(), upsert: vi.fn(), find: vi.fn(), update: vi.fn(), runCreate: vi.fn(), runUpdate: vi.fn(), running: vi.fn(),
}));
vi.mock("@/lib/ananas/client", () => ({ AnanasClient: class { orders = mocks.orders; shipments = mocks.shipments; } }));
vi.mock("@/lib/db", () => {
  const db = { ananasOrder: { upsert: mocks.upsert, findMany: mocks.find, update: mocks.update },
    ananasSyncRun: { create: mocks.runCreate, update: mocks.runUpdate, findFirst: mocks.running }, $queryRaw: vi.fn(),
    $transaction: async (arg: unknown) => typeof arg === "function" ? arg(db) : Promise.all(arg as Promise<unknown>[]),
  };
  return { db };
});
import { syncAnanasOrders } from "@/lib/ananas/orders-sync";
const raw = { id: "A-B", createdDate: "2026-09-24T12:00:00Z", totalPrice: 1200, currency: "RSD", items: [{ id: "i", quantity: 1, basePrice: 1200, grandTotal: 1200, grandTotalWithoutVat: 1000, vat: 20 }] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.runCreate.mockResolvedValue({ id: "run" }); mocks.running.mockResolvedValue(null);
  mocks.orders.mockResolvedValue([raw]); mocks.shipments.mockResolvedValue([]); mocks.find.mockResolvedValue([]); mocks.upsert.mockResolvedValue({});
});
const start = new Date("2026-09-24T00:00:00Z"), end = new Date("2026-09-25T00:00:00Z");
describe("read-only order synchronization", () => {
  it("uses the same unique remote ID on repeat imports and never invokes local fulfillment models", async () => {
    await syncAnanasOrders(start, end); await syncAnanasOrders(start, end);
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.upsert.mock.calls.map(c => c[0].where)).toEqual([{ id: "A-B" }, { id: "A-B" }]);
    expect(mocks.runUpdate.mock.calls.at(-1)?.[0].data).toMatchObject({ status: "SUCCESS", count: 1 });
  });
  it("checks an older open order by identity even when the new-order range is empty", async () => {
    mocks.orders.mockResolvedValueOnce([]).mockResolvedValueOnce([raw]);
    mocks.find.mockResolvedValue([{ id: "A-B", items: [{ quantity: 1 }] }]);
    mocks.shipments.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ orderId: "A-B", suborderId: "A-B-FBA-1", status: "DELIVERED", items: [{ orderedQuantity: 1 }] }]);
    await syncAnanasOrders(start, end);
    expect(mocks.orders.mock.calls[1][0].get("orderId")).toBe("A-B");
    expect(mocks.update.mock.calls[0][0]).toMatchObject({ where: { id: "A-B" }, data: { status: "Isporučeno", needsRefresh: false } });
  });
  it("fails before any import if the API returns invalid amounts", async () => {
    mocks.orders.mockResolvedValue([{ ...raw, totalPrice: -1 }]);
    await expect(syncAnanasOrders(start, end)).rejects.toThrow();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.runUpdate.mock.calls[0][0].data.status).toBe("FAILED");
  });
  it("does not advance the successful cursor when shipment retrieval fails", async () => {
    mocks.shipments.mockRejectedValue(new Error("Ananas čitanje nije uspelo (HTTP 429)."));
    await expect(syncAnanasOrders(start, end)).rejects.toThrow("429");
    expect(mocks.runUpdate.mock.calls[0][0].data.status).toBe("FAILED");
  });
  it("rejects an overlapping run before making API requests", async () => {
    mocks.running.mockResolvedValue({ id: "other" });
    await expect(syncAnanasOrders(start, end)).rejects.toThrow("već u toku");
    expect(mocks.orders).not.toHaveBeenCalled();
  });
});
