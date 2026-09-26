import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ order: vi.fn(), existing: vi.fn(), lockedExisting: vi.fn(), raw: vi.fn(), create: vi.fn(), verify: vi.fn(), enqueue: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: m.order }, reclamation: { findUnique: m.existing }, $transaction: m.tx } }));
vi.mock("@/lib/api/uploads", () => ({ isAllowedReclamationPhotoUrl: () => true, verifyReclamationUploads: m.verify }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: m.enqueue }));
vi.mock("@/lib/api/order-access", () => ({ verifyOrderAccessToken: () => false }));
import { createSocialReclamation } from "@/lib/api/reclamations";
const order = { id: "o1", number: "SPC-TEST", status: "ISPORUCENO", userId: null, guestEmail: "test@example.test", shipFirstName: "Test", shipLastName: "Kupac", shipPhone: "synthetic", items: [{ id: "item", sku: "IRON", supplierExternalSku: null }] };
const input = { orderNumberOrFiscal: order.number, sku: "IRON", quantity: 1, description: "Pegla ne greje", photos: [] };
const context = { orderId: order.id, id: "social-case", note: "facebook transcript", request: "ZAMENA" as const, type: "KVAR" as const };
beforeEach(() => {
  vi.resetAllMocks(); m.order.mockResolvedValue(order); m.existing.mockResolvedValue(null); m.lockedExisting.mockResolvedValue(null);
  m.raw.mockImplementation(async (sql: TemplateStringsArray) => sql.join("").includes('FROM "Order"') ? [{ status: order.status, number: order.number }] : [{ reclamationCount: 1, productId: null, qty: 1 }]);
  m.create.mockResolvedValue({ id: context.id, number: "R-1-SPC-TEST" });
  m.tx.mockImplementation(async fn => fn({ $queryRaw: m.raw, reclamation: { findUnique: m.lockedExisting, findMany: async () => [], create: m.create } }));
});
it("writes linked metadata, photos and requested outcome in the existing ERP record", async () => {
  expect(await createSocialReclamation(input, context)).toMatchObject({ ok: true, number: "R-1-SPC-TEST" });
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: context.id, orderId: order.id, orderItemId: "item", sku: "IRON", request: "ZAMENA", type: "KVAR", adminNote: context.note, events: { create: expect.objectContaining({ status: "PRIMLJENO", note: context.note }) } }) }));
});
it("rechecks idempotency under the order lock before incrementing counters or creating another case", async () => {
  m.lockedExisting.mockResolvedValue({ id: context.id, number: "R-1-SPC-TEST" });
  expect(await createSocialReclamation(input, context)).toMatchObject({ ok: true });
  expect(m.raw).toHaveBeenCalledTimes(1); expect(m.raw.mock.calls[0][0].join("")).toContain("FOR UPDATE"); expect(m.create).not.toHaveBeenCalled();
});
it("recovers an existing case even after order state changed, but rejects another order identity", async () => {
  m.order.mockResolvedValue({ ...order, status: "OTKAZANO" });
  m.existing.mockResolvedValue({ id: context.id, number: "R-1-SPC-TEST", orderId: order.id });
  expect(await createSocialReclamation(input, context)).toMatchObject({ ok: true }); expect(m.tx).not.toHaveBeenCalled();
  expect(await createSocialReclamation(input, { ...context, orderId: "other" })).toMatchObject({ ok: false, reason: "UNAUTHORIZED" });
});
