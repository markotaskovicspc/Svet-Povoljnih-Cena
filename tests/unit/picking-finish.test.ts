import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), queue: vi.fn(), labels: vi.fn(), lock: vi.fn(), previousJob: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: mocks.lock, backgroundJob: { findUnique: mocks.previousJob } }) } }));
vi.mock("@/lib/admin", () => ({ withAdminState: (_: unknown, fn: (id: string) => unknown) => () => fn("actor") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/picking.server", () => ({ getPickingSession: mocks.session }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.queue }));
vi.mock("@/lib/admin/pickup-batch.server", () => ({ prepareWarehousePickupLabels: mocks.labels }));
import { finishPicking } from "@/app/admin/erp/preuzimanja/[id]/picking/actions";
const request = { batchId: "batch", planHash: "a".repeat(64), mode: "shortage" as const, packagesConfirmed: false };
const session = { id: "batch", number: "PRE-2026-01", editable: true, planHash: request.planHash, rows: [{ key: "a", sku: "001", name: "Artikal", quantity: 3, allocations: [{ orderNumber: "26-01", quantity: 3 }] }], progress: { a: 0 }, reviewedRows: ["a"] };
beforeEach(() => { vi.clearAllMocks(); mocks.previousJob.mockResolvedValue(null); mocks.session.mockResolvedValue(structuredClone(session)); });
it("queues a zero shortage under the batch lock with a stable retry key", async () => {
  await finishPicking(request); await finishPicking(request);
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.session.mock.invocationCallOrder[0]);
  expect(mocks.queue.mock.calls[0][0]).toEqual(mocks.queue.mock.calls[1][0]);
  expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ shortages: [expect.objectContaining({ missing: 3, picked: 0 })] }) }), expect.anything());
  expect(mocks.labels).not.toHaveBeenCalled();
});
it("rejects unreviewed rows and stale plans before queuing", async () => {
  mocks.session.mockResolvedValue({ ...session, reviewedRows: [] });
  await expect(finishPicking(request)).rejects.toThrow("svih artikala");
  mocks.session.mockResolvedValue({ ...session, planHash: "b".repeat(64) });
  await expect(finishPicking(request)).rejects.toThrow("promenjen");
  expect(mocks.queue).not.toHaveBeenCalled();
});
it("does not insert an already queued report inside a PostgreSQL transaction", async () => {
  mocks.previousJob.mockResolvedValue({ id: "job", status: "QUEUED" });
  await finishPicking(request);
  expect(mocks.queue).not.toHaveBeenCalled();
});
it("requires full picking and package confirmation before calling courier preparation", async () => {
  await expect(finishPicking({ ...request, mode: "labels", packagesConfirmed: true })).rejects.toThrow("sve artikle");
  mocks.session.mockResolvedValue({ ...session, progress: { a: 3 } });
  await expect(finishPicking({ ...request, mode: "labels" })).rejects.toThrow("spakovane");
  expect(mocks.labels).not.toHaveBeenCalled();
  const result = await finishPicking({ ...request, mode: "labels", packagesConfirmed: true });
  expect(mocks.labels).toHaveBeenCalledWith("batch", "actor", request.planHash);
  expect(result.result?.labelUrl).toContain("/batch/labels");
  expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ mode: "labels" }) }));
});
