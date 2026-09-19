import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ receipt: vi.fn(), count: vi.fn(), lines: vi.fn(), issue: vi.fn(), lock: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  stockMovement: { findUnique: m.receipt, count: m.count },
  fiscalDocumentLine: { findMany: m.lines },
} }));
vi.mock("@/lib/fiscal/issue", () => ({ issueFiscalRefundUnderLock: m.issue }));
vi.mock("@/lib/fiscal/return-lock", () => ({ withOrderReturnLock: m.lock }));
vi.mock("@/lib/background-jobs", () => ({ PermanentBackgroundJobError: class extends Error {} }));
import { refundReceivedOrder } from "@/lib/fiscal/returned-order-refund";

beforeEach(() => {
  vi.clearAllMocks();
  m.lock.mockImplementation((_id, run) => run());
  m.receipt.mockResolvedValue({ id: "receipt", orderId: "order", orderItemId: "item", warehouseId: "MAG-004", idempotencyKey: "order-return:SPC:item:1" });
  m.count.mockResolvedValue(1);
  m.lines.mockResolvedValue([{ id: "line", qty: 3, refundedQty: 0, fiscalDocument: { buyerId: "10:123456789", paymentMethod: "POUZECE_GOTOVINA" } }]);
  m.issue.mockResolvedValue({ ok: true, paymentErrors: [] });
});

describe("automatic fiscal refund after physical receipt", () => {
  it("refunds one received unit out of three, using the original payment and buyer", async () => {
    await refundReceivedOrder({ movementId: "receipt" });
    expect(m.lock).toHaveBeenCalledWith("order", expect.any(Function));
    expect(m.issue).toHaveBeenCalledWith(expect.objectContaining({
      fiscalLineIds: ["line"], quantities: { line: 1 }, warehouseId: "MAG-004",
      buyerId: "10:123456789", paymentReturnMethod: "POUZECE_GOTOVINA",
    }));
  });
  it("does not resend a refund when the worker runs again", async () => {
    m.lines.mockResolvedValue([{ id: "line", qty: 3, refundedQty: 1 }]);
    await refundReceivedOrder({ movementId: "receipt" });
    expect(m.issue).not.toHaveBeenCalled();
  });
  it("only refunds the new quantity when another package is received", async () => {
    m.count.mockResolvedValue(2);
    const lines = await m.lines();
    lines[0].refundedQty = 1;
    await refundReceivedOrder({ movementId: "receipt" });
    expect(m.issue.mock.calls[0][0].quantities).toEqual({ line: 1 });
  });
  it("leaves a clear pending reason for missing buyer identity and accepts a later correction", async () => {
    const lines = await m.lines();
    lines[0].fiscalDocument.buyerId = null;
    await expect(refundReceivedOrder({ movementId: "receipt" })).rejects.toThrow("identifikaciju kupca");
    expect(m.issue).not.toHaveBeenCalled();
    await refundReceivedOrder({ movementId: "receipt", buyerId: "20:TEST-ID" });
    expect(m.issue.mock.calls[0][0].buyerId).toBe("20:TEST-ID");
  });
  it("does not treat absence of a fiscal sale as a successful refund", async () => {
    m.lines.mockResolvedValue([]);
    await expect(refundReceivedOrder({ movementId: "receipt" })).rejects.toThrow("nema izdatog fiskalnog računa");
  });
  it("preserves gateway errors for retry/review without completing the job", async () => {
    m.issue.mockResolvedValue({ ok: false, error: "Proverite badi portal" });
    await expect(refundReceivedOrder({ movementId: "receipt" })).rejects.toThrow("badi portal");
  });
  it("does not turn a repair/replacement reclamation into a money refund", async () => {
    m.receipt.mockResolvedValue({ orderId: "order", orderItemId: "item", idempotencyKey: "reclamation-return:claim" });
    await expect(refundReceivedOrder({ movementId: "receipt" })).rejects.toThrow("nije pronađen");
    expect(m.issue).not.toHaveBeenCalled();
  });
});
