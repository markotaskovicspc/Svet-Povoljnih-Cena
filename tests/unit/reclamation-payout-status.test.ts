import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ claim: vi.fn(), lock: vi.fn(), payout: vi.fn(), update: vi.fn(), event: vi.fn(), enqueue: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
vi.mock("@/lib/fiscal/return-lock", () => ({ lockOrderReturn: m.lock }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: m.enqueue }));
import { updateReclamationStatus } from "@/lib/api/reclamation-status";
beforeEach(() => {
  vi.resetAllMocks();
  m.transaction.mockImplementation(fn => fn({ paymentRefund: { findUnique: m.payout }, reclamation: { findUnique: m.claim, update: m.update }, reclamationStatusEvent: { create: m.event } }));
  m.claim.mockResolvedValue({ orderId: "order" });
  m.event.mockResolvedValue({ id: "event" });
});
it("blocks closing or rejecting a claim with an unpaid prepared refund", async () => {
  m.payout.mockResolvedValue({ status: "PENDING" });
  await expect(updateReclamationStatus({ reclamationId: "claim", status: "RESENO" })).rejects.toThrow("potvrdite izvršenu uplatu");
  await expect(updateReclamationStatus({ reclamationId: "claim", status: "ODBIJENO" })).rejects.toThrow("potvrdite izvršenu uplatu");
  expect(m.update).not.toHaveBeenCalled();
  expect(m.enqueue).not.toHaveBeenCalled();
});
it("preserves status changes for completed payouts and legacy claims without a payout", async () => {
  m.payout.mockResolvedValueOnce({ status: "COMPLETED" }).mockResolvedValueOnce(null);
  await updateReclamationStatus({ reclamationId: "claim", status: "RESENO" });
  await updateReclamationStatus({ reclamationId: "legacy", status: "RESENO" });
  expect(m.update).toHaveBeenCalledTimes(2);
});

it("does not change a claim while its order refund is being processed", async () => {
  m.lock.mockRejectedValue(new Error("Povrat se već obrađuje"));
  await expect(updateReclamationStatus({ reclamationId: "claim", status: "RESENO" })).rejects.toThrow("već obrađuje");
  expect(m.update).not.toHaveBeenCalled();
});
