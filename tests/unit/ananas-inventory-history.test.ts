import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ policy: vi.fn(), post: vi.fn(), sync: vi.fn(), update: vi.fn(), count: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@/lib/ananas/inventory.server", () => ({ ANANAS_INVENTORY_KEY: "ananas-inventory", getAnanasInventoryPolicy: m.policy, postPendingAnanasInventory: m.post }));
vi.mock("@/lib/ananas/sync", () => ({ syncAnanasDocuments: m.sync }));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: vi.fn(), adminSetting: {
    update: m.update, findUniqueOrThrow: async () => ({ value: m.state }), findUnique: async () => ({ value: m.state }),
  } }),
  ananasDocument: { count: m.count }, warehouseStock: { count: async () => 0 },
} }));
import { advanceAnanasInventoryHistory } from "@/lib/ananas/inventory-history.server";
const start = "2025-05-31T22:00:00.000Z";
beforeEach(() => {
  vi.resetAllMocks();
  m.state = { enabled: true, allowNegative: true, warehouseId: "ananas", historyThrough: "2026-02-21T22:00:00.000Z" };
  m.policy.mockImplementation(async () => m.state);
  m.update.mockImplementation(async ({ data }) => { m.state = data.value; return { value: m.state }; });
  m.count.mockResolvedValue(0);
  m.post.mockResolvedValue({ posted: 0, failed: 0 }); m.sync.mockResolvedValue({ count: 0 });
});
it("rescans from June once to recover refunds omitted by the former invoiceId identity", async () => {
  await advanceAnanasInventoryHistory(undefined, new Date("2026-10-11Z"));
  expect(m.sync).toHaveBeenCalledWith(new Date(start), new Date("2025-06-03T22:00:00.000Z"), "INVENTORY_HISTORY");
  expect(m.state.documentIdentityVersion).toBe(2);
  expect(m.state.allowNegative).toBe(true);
  expect(m.state.warehouseId).toBe("ananas");
  await advanceAnanasInventoryHistory(undefined, new Date("2026-10-11Z"));
  expect(m.sync.mock.calls[1][0]).toEqual(new Date("2025-06-03T22:00:00.000Z"));
});
it("preserves the saved checkpoint once fiscal-number rescan has started", async () => {
  m.state.documentIdentityVersion = 2;
  await advanceAnanasInventoryHistory(undefined, new Date("2026-10-11Z"));
  expect(m.sync.mock.calls[0][0]).toEqual(new Date("2026-02-21T22:00:00.000Z"));
});

it("shortens timed-out provider windows without advancing or rewinding the checkpoint", async () => {
  m.state.documentIdentityVersion = 2;
  const checkpoint = m.state.historyThrough;
  m.sync.mockRejectedValueOnce(new Error("Ananas nije odgovorio u predviđenom roku."));
  await expect(advanceAnanasInventoryHistory(undefined, new Date("2026-10-11Z"))).rejects.toThrow("24 sati");
  expect(m.state.historyThrough).toBe(checkpoint);
  expect(m.state.historyWindowHours).toBe(24);
  expect(new Date(m.state.leaseUntil as string).getTime()).toBe(0);
  await advanceAnanasInventoryHistory(undefined, new Date("2026-10-11Z"));
  expect(m.sync.mock.calls[1]).toEqual([new Date(checkpoint as string), new Date("2026-02-22T22:00:00.000Z"), "INVENTORY_HISTORY"]);
});
it("bounds retries at one hour and does not shrink non-timeout failures", async () => {
  m.state.documentIdentityVersion = 2; m.state.historyWindowHours = 1;
  m.sync.mockRejectedValue(new Error("Ananas nije odgovorio u predviđenom roku."));
  await expect(advanceAnanasInventoryHistory()).rejects.toThrow("predviđenom roku");
  expect(m.state.historyWindowHours).toBe(1);
  m.state.historyWindowHours = 72;
  m.sync.mockRejectedValue(new Error("Ananas stavke već knjiženog dokumenta su promenjene."));
  await expect(advanceAnanasInventoryHistory()).rejects.toThrow("promenjene");
  expect(m.state.historyWindowHours).toBe(72);
});

it("keeps draining formerly errored documents while retries make progress", async () => {
  m.state.documentIdentityVersion = 2; m.state.historyThrough = "2026-10-11T00:00:00.000Z";
  m.count.mockResolvedValueOnce(0).mockResolvedValueOnce(40).mockResolvedValueOnce(40).mockResolvedValueOnce(200);
  m.post.mockResolvedValueOnce({ posted: 40, failed: 0 }).mockResolvedValueOnce({ posted: 40, failed: 0 });
  const result = await advanceAnanasInventoryHistory(undefined, new Date("2026-10-11T00:00:00.000Z"));
  expect(result.complete).toBe(false);
  expect(result.needsReview).toBe(false);
  expect(result.pendingTotal).toBe(40);
});
it("requests review when all remaining documents fail and no retry makes progress", async () => {
  m.state.documentIdentityVersion = 2; m.state.historyThrough = "2026-10-11T00:00:00.000Z";
  m.count.mockResolvedValueOnce(0).mockResolvedValueOnce(40).mockResolvedValueOnce(40).mockResolvedValueOnce(200);
  const result = await advanceAnanasInventoryHistory(undefined, new Date("2026-10-11T00:00:00.000Z"));
  expect(result.needsReview).toBe(true);
});
