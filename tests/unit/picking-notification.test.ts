import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn(), session: vi.fn(), pdf: vi.fn() }));
vi.mock("@/lib/email/tracking", () => ({ trackedDispatch: mocks.send }));
vi.mock("@/lib/admin/picking.server", () => ({ getPickingSession: mocks.session }));
vi.mock("@/lib/admin/pickup-labels.server", () => ({ buildPickupLabelsResponse: mocks.pdf }));
import { sendPickingNotification } from "@/lib/admin/picking-notification.server";
import type { PickingNotification } from "@/lib/admin/picking-notification";
const payload: PickingNotification = { batchId: "batch", batchNumber: "PRE-01", planHash: "a".repeat(64), operationKey: "b".repeat(64), mode: "shortage",
  shortages: [{ sku: "001", name: "A < B", required: 2, picked: 0, missing: 2, orders: [{ number: "26-01", quantity: 2 }] }] };
beforeEach(() => { vi.clearAllMocks(); mocks.send.mockResolvedValue({ ok: true }); mocks.session.mockResolvedValue({ labelsReady: true, planHash: payload.planHash, rows: [{ key: "a", quantity: 2, allocations: [] }], progress: { a: 2 }, reviewedRows: [] }); });
it("reports zero counts, batch/order numbers and escapes catalog text", async () => {
  await sendPickingNotification(payload);
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "podrska@svetpovoljnihcena.rs", text: expect.stringContaining("26-01"), html: expect.stringContaining("A &lt; B"), idempotencyKey: `picking-shortage:${payload.operationKey}` }));
  expect(mocks.pdf).not.toHaveBeenCalled();
});
it("attaches the private PDF rather than a public storage URL", async () => {
  mocks.pdf.mockResolvedValue(new Response("%PDF-fixture", { headers: { "content-type": "application/pdf" } }));
  await sendPickingNotification({ ...payload, mode: "labels", shortages: [] });
  expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: "magacin@svetpovoljnihcena.rs", attachments: [{ filename: "PRE-01-adresnice.pdf", content: Buffer.from("%PDF-fixture").toString("base64"), contentType: "application/pdf" }] }));
});
it("refuses to send obsolete or incomplete label sets", async () => {
  mocks.session.mockResolvedValue({ planHash: "c".repeat(64), labelsReady: true });
  await expect(sendPickingNotification({ ...payload, mode: "labels" })).rejects.toThrow("Sadržaj naloga");
  expect(mocks.send).not.toHaveBeenCalled();
});
it("propagates email failure so the job can retry", async () => {
  mocks.send.mockResolvedValue({ ok: false, error: "ses:timeout" });
  await expect(sendPickingNotification(payload)).rejects.toThrow("ses:timeout");
});
