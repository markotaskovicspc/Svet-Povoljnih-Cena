import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ tx: { $queryRaw: vi.fn(), pickingScanEvent: { findUnique: vi.fn(), create: vi.fn() } }, session: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (fn: (tx: unknown) => unknown) => fn(mock.tx) } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/picking.server", () => ({ getPickingSession: mock.session }));
vi.mock("@/lib/admin", () => ({ withAdminState: (meta: unknown, fn: (id: string) => unknown) => async () => { mock.auth(meta); return fn("admin-1"); } }));
import { recordPicking } from "@/app/admin/erp/preuzimanja/[id]/picking/actions";
const request = { id: "9aab9d6c-7f2c-4af5-aef4-efb4c532adcf", batchId: "b1", planHash: "a".repeat(64), rowKey: "sku1", delta: 1, note: "" };
const session = { editable: true, planHash: request.planHash, rows: [{ key: "sku1", sku: "001", quantity: 2 }], progress: { sku1: 1 } };
beforeEach(() => { vi.clearAllMocks(); mock.tx.pickingScanEvent.findUnique.mockResolvedValue(null); mock.session.mockResolvedValue(structuredClone(session)); });
describe("picking write safety", () => {
 it("requires OPS and locks the batch before reading quantities", async () => {
  await recordPicking(request);
  expect(mock.auth).toHaveBeenCalledWith(expect.objectContaining({ allowed: ["OPS"] }));
  expect(mock.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mock.session.mock.invocationCallOrder[0]);
  expect(mock.tx.pickingScanEvent.create).toHaveBeenCalledWith({ data: { ...request, actorId: "admin-1" } });
 });
 it("retries the same request without adding quantity again", async () => {
  mock.tx.pickingScanEvent.findUnique.mockResolvedValue({ ...request, actorId: "admin-1" });
  await recordPicking(request);
  expect(mock.tx.pickingScanEvent.create).not.toHaveBeenCalled();
 });
 it("rejects reuse of a request ID with different content", async () => {
  mock.tx.pickingScanEvent.findUnique.mockResolvedValue({ ...request, delta: 2, actorId: "admin-1" });
  await expect(recordPicking(request)).rejects.toThrow("drugo evidentiranje");
 });
 it("rejects stale parcel plans and locked batches", async () => {
  mock.session.mockResolvedValue({ ...session, planHash: "b".repeat(64) });
  await expect(recordPicking(request)).rejects.toThrow("Sadržaj naloga");
  mock.session.mockResolvedValue({ ...session, editable: false });
  await expect(recordPicking(request)).rejects.toThrow("zaključan");
  expect(mock.tx.pickingScanEvent.create).not.toHaveBeenCalled();
 });
 it("uses fresh count after lock to reject competing over-picks", async () => {
  mock.session.mockResolvedValue({ ...session, progress: { sku1: 2 } });
  await expect(recordPicking(request)).rejects.toThrow("Količina");
  expect(mock.tx.pickingScanEvent.create).not.toHaveBeenCalled();
 });
 it("records shortage notes without changing quantities", async () => {
  await recordPicking({ ...request, delta: 0, note: "Nedostaje 1 kom." });
  expect(mock.tx.pickingScanEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ delta: 0, note: "Nedostaje 1 kom." }) });
 });
});
