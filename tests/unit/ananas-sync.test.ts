import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ananasInventoryPlan } from "@/lib/ananas/inventory-plan";
const m = vi.hoisted(() => ({ documents: vi.fn(), normalize: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), transaction: vi.fn(), latest: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { ananasSyncRun: { create: m.create, update: m.update, findFirst: m.latest }, $transaction: m.transaction } }));
vi.mock("@/lib/ananas/client", () => ({ AnanasClient: class { documents = m.documents; } }));
vi.mock("@/lib/ananas/documents", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/ananas/documents")>(), normalizeAnanasDocument: m.normalize }));
import { syncAnanasDocuments, syncAnanasAutomatically } from "@/lib/ananas/sync";
beforeEach(() => {
  vi.resetAllMocks(); m.create.mockResolvedValue({ id: "run" }); m.update.mockResolvedValue({}); m.latest.mockResolvedValue(null);
  m.documents.mockResolvedValue([{ id: "one" }]);
  m.normalize.mockImplementation((row, kind) => ({ externalId: row.id, kind, fiscalNumber: `${kind}-1` }));
  m.transaction.mockImplementation(async fn => fn({ $queryRaw: vi.fn(), ananasDocument: { upsert: m.upsert, findUnique: vi.fn().mockResolvedValue(null) }, ananasSyncRun: { update: m.update } }));
});
afterEach(() => vi.restoreAllMocks());
it("identifies a posted receipt conflict without overwriting it or logging buyer data", async () => {
  const storedItems = [{ sku: "1145", name: "Drill", quantity: 1 }];
  const incomingItems = [{ sku: "1145", name: "Drill", quantity: 2 }];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  m.normalize.mockImplementation((row, kind) => ({ externalId: row.id, kind, fiscalNumber: "FISCAL-1", items: incomingItems }));
  m.transaction.mockImplementation(async fn => fn({ $queryRaw: vi.fn(), ananasDocument: {
    upsert: m.upsert, findUnique: vi.fn().mockResolvedValue({ id: "posted-doc", kind: "SALE", fiscalNumber: "FISCAL-1",
      items: storedItems, inventoryPostedAt: new Date(), inventoryFingerprint: ananasInventoryPlan("SALE", storedItems).fingerprint }),
  }, ananasSyncRun: { update: m.update } }));
  await expect(syncAnanasDocuments(new Date("2026-09-01Z"), new Date("2026-09-02Z"))).rejects.toThrow(/FISCAL-1.*posted-doc/);
  expect(m.upsert).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith("ananas.inventory.document-conflict", expect.objectContaining({
    documentId: "posted-doc", storedLines: [{ sku: "1145", qtyDelta: -1 }], incomingLines: [{ sku: "1145", qtyDelta: -2 }],
  }));
  expect(JSON.stringify(log.mock.calls)).not.toContain("Drill");
});
it("upserts identical provider keys on repeated imports and commits success with documents", async () => {
  await syncAnanasDocuments(new Date("2026-09-01Z"), new Date("2026-09-02Z"));
  await syncAnanasDocuments(new Date("2026-09-01Z"), new Date("2026-09-02Z"));
  expect(m.upsert).toHaveBeenCalledTimes(4);
  expect(m.upsert.mock.calls[0][0].where).toEqual({ kind_fiscalNumber: { kind: "SALE", fiscalNumber: "SALE-1" } });
  expect(m.upsert.mock.calls[0][0].where).toEqual(m.upsert.mock.calls[2][0].where);
  expect(m.upsert.mock.calls[0][0].where).not.toEqual(m.upsert.mock.calls[1][0].where);
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCESS", count: 2 }) }));
});
it("keeps separate fiscal refunds even when Ananas reuses the original invoiceId", async () => {
  m.documents.mockImplementation(async kind => kind === "SALE" ? [] : [
    { id: "1411033866", fiscal: "K5CYLD29-GESE6HO0-597" },
    { id: "1411033866", fiscal: "K5CYLD29-C38FDVO0-403" },
  ]);
  m.normalize.mockImplementation((row, kind) => ({ externalId: row.id, kind, fiscalNumber: row.fiscal }));
  expect((await syncAnanasDocuments(new Date("2026-02-21Z"), new Date("2026-02-24Z"))).count).toBe(2);
  expect(m.upsert.mock.calls.map(call => call[0].where)).toEqual([
    { kind_fiscalNumber: { kind: "REFUND", fiscalNumber: "K5CYLD29-GESE6HO0-597" } },
    { kind_fiscalNumber: { kind: "REFUND", fiscalNumber: "K5CYLD29-C38FDVO0-403" } },
  ]);
});
it("writes no receipts when any incoming document fails validation", async () => {
  m.normalize.mockImplementationOnce(() => ({ kind: "SALE", externalId: "one" })).mockImplementationOnce(() => { throw new Error("PIB Ananas dokumenta ne odgovara"); });
  await expect(syncAnanasDocuments(new Date("2026-09-01Z"), new Date("2026-09-02Z"))).rejects.toThrow(/PIB/);
  expect(m.transaction).not.toHaveBeenCalled(); expect(m.upsert).not.toHaveBeenCalled();
  expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
});
it("resumes an outage in bounded chunks with overlap instead of skipping the missing period", async () => {
  m.latest.mockResolvedValue({ to: new Date("2026-07-01Z") });
  await syncAnanasAutomatically(new Date("2026-09-24Z"));
  expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ from: new Date("2026-06-24Z"), to: new Date("2026-07-25Z") }) });
  const ranges = m.documents.mock.calls.filter(call => call[0] === "SALE");
  expect(ranges).toHaveLength(11);
  expect(ranges[0].slice(1)).toEqual([new Date("2026-06-24Z"), new Date("2026-06-27Z")]);
  expect(ranges.at(-1)?.[2]).toEqual(new Date("2026-07-25Z"));
  for (let i = 1; i < ranges.length; i++) expect(ranges[i][1]).toEqual(ranges[i - 1][2]);
  // Duplicate provider documents across windows are persisted only once.
  expect(m.upsert).toHaveBeenCalledTimes(2);
});
it("keeps previous imported data intact if a later window times out", async () => {
  m.documents.mockImplementation(async (_kind, from: Date) => {
    if (from >= new Date("2026-09-04Z")) throw new DOMException("timeout", "TimeoutError");
    return [{ id: "one" }];
  });
  await expect(syncAnanasDocuments(new Date("2026-09-01Z"), new Date("2026-09-10Z"))).rejects.toThrow(/predviđenom roku/);
  expect(m.upsert).not.toHaveBeenCalled();
});
