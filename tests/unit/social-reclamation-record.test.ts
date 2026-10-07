import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ order: vi.fn(), existing: vi.fn(), lockedExisting: vi.fn(), open: vi.fn(), raw: vi.fn(), create: vi.fn(), verify: vi.fn(), enqueue: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { order: { findUnique: m.order }, reclamation: { findUnique: m.existing }, $transaction: m.tx } }));
vi.mock("@/lib/api/uploads", () => ({ isAllowedReclamationPhotoUrl: () => true, verifyReclamationUploads: m.verify }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: m.enqueue }));
vi.mock("@/lib/api/order-access", () => ({ verifyOrderAccessToken: () => false }));
import { createGuestReclamation, createReclamationSchema, createSocialReclamation } from "@/lib/api/reclamations";
import { createReclamationLinkToken } from "@/lib/api/reclamation-link-token";
const order = { id: "o1", number: "SPC-TEST", status: "ISPORUCENO", userId: null, guestEmail: "test@example.test", shipFirstName: "Test", shipLastName: "Kupac", shipPhone: "synthetic", items: [{ id: "item", sku: "IRON", supplierExternalSku: null }] };
const input = { orderNumberOrFiscal: order.number, sku: "IRON", quantity: 1, description: "Pegla ne greje", photos: [] };
const context = { orderId: order.id, id: "social-case", note: "facebook transcript", request: "ZAMENA" as const, type: "KVAR" as const };
beforeEach(() => {
  vi.stubEnv("ORDER_ACCESS_TOKEN_SECRET", "test-private-reclamation-secret");
  vi.resetAllMocks(); m.order.mockResolvedValue(order); m.existing.mockResolvedValue(null); m.lockedExisting.mockResolvedValue(null); m.open.mockResolvedValue(null);
  m.raw.mockImplementation(async (sql: TemplateStringsArray) => sql.join("").includes('FROM "Order"') ? [{ status: order.status, number: order.number }] : [{ reclamationCount: 1, productId: null, qty: 1 }]);
  m.create.mockResolvedValue({ id: context.id, number: "R-1-SPC-TEST" });
  m.tx.mockImplementation(async fn => fn({ $queryRaw: m.raw, reclamation: { findUnique: m.lockedExisting, findFirst: m.open, findMany: async () => [], create: m.create } }));
});
afterEach(() => vi.unstubAllEnvs());
it.each(["KVAR", "FIZICKO_OSTECENJE", "POGRESNO_ISPORUCENO", "NIJE_ISPORUCENO"] as const)("validates and saves problem type %s and the requested remedy through a staff link", async (type) => {
  const { token } = createReclamationLinkToken(order.number);
  const parsed = createReclamationSchema.parse({ ...input, type, request: "ZAMENA" });
  expect(await createGuestReclamation(parsed, token)).toMatchObject({ ok: true });
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderId: order.id, description: input.description, quantity: 1, type, request: "ZAMENA" }) }));
});
it("rejects another order's link before verifying uploads or writing a record", async () => {
  const { token } = createReclamationLinkToken("SPC-OTHER");
  expect(await createGuestReclamation(input, token)).toEqual({ ok: false, reason: "UNAUTHORIZED" });
  expect(m.verify).not.toHaveBeenCalled();
  expect(m.tx).not.toHaveBeenCalled();
});
it("writes linked metadata, photos and requested outcome in the existing ERP record", async () => {
  expect(await createSocialReclamation(input, context)).toMatchObject({ ok: true, number: "R-1-SPC-TEST" });
  expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ id: context.id, orderId: order.id, orderItemId: "item", sku: "IRON", request: "ZAMENA", type: "KVAR", adminNote: context.note, events: { create: expect.objectContaining({ status: "PRIMLJENO", note: context.note }) } }) }));
});
it("email workflow records the case without sending an automatic customer receipt", async () => {
  expect(await createSocialReclamation(input, { ...context, customerReplyDraftOnly: true })).toMatchObject({ ok: true });
  expect(m.create).toHaveBeenCalled();
  expect(m.enqueue.mock.calls.some(([job]) => job.kind === 'RECLAMATION_RECEIPT')).toBe(false);
  expect(m.enqueue.mock.calls.some(([job]) => job.kind === 'RECLAMATION_NOTIFICATION')).toBe(true);
});
it("queues an internal notification atomically even when the buyer has no email", async () => {
  m.order.mockResolvedValue({ ...order, guestEmail: null });
  const { token } = createReclamationLinkToken(order.number);
  expect(await createGuestReclamation(input, token)).toMatchObject({ ok: true });
  expect(m.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "RECLAMATION_NOTIFICATION", payload: { reclamationId: context.id }, idempotencyKey: `reclamation-notification:${context.id}` }), expect.objectContaining({ reclamation: expect.anything() }));
  expect(m.enqueue.mock.calls.some(([job]) => job.kind === "RECLAMATION_RECEIPT")).toBe(false);
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

it("reuses an open case under the order lock even with a different request id, without counters or repeat receipts",async()=>{m.open.mockResolvedValue({id:'existing-case',number:'R-1-SPC-TEST'});expect(await createSocialReclamation(input,{...context,id:'another-id'})).toMatchObject({ok:true,number:'R-1-SPC-TEST',alreadyExists:true});expect(m.raw).toHaveBeenCalledTimes(1);expect(m.create).not.toHaveBeenCalled();expect(m.enqueue).not.toHaveBeenCalled();});
