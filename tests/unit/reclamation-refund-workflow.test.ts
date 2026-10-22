import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ claim: vi.fn(), payout: vi.fn(), create: vi.fn(), update: vi.fn(), lines: vi.fn(), documents: vi.fn(), receipts: vi.fn(), others: vi.fn(), issue: vi.fn(), close: vi.fn(), event: vi.fn(), tx: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  reclamation: { findUnique: m.claim, update: m.close }, paymentRefund: { findUnique: m.payout, create: m.create, update: m.update, findMany: m.others },
  fiscalDocumentLine: { findMany: m.lines }, fiscalDocument: { findMany: m.documents }, stockMovement: { findMany: m.receipts },
  reclamationStatusEvent: { create: m.event }, $transaction: m.tx,
} }));
vi.mock("@/lib/fiscal/return-lock", () => ({ withOrderReturnLock: async (_id: string, fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/fiscal/issue", () => ({ issueFiscalRefundUnderLock: m.issue }));
import { db } from "@/lib/db";
import { issueReclamationRefund, confirmReclamationPayout } from "@/lib/admin/reclamation-refund.server";
const base = "1600000000000001";
const account = base + (BigInt(98) - BigInt(base + "00") % BigInt(97)).toString().padStart(2, "0");
const plan = { reclamationId: "claim", bankAccount: account, quantity: 2, lines: [{ id: "sale", qty: 2 }], confirmedPaidBy: "marko" };
const payout = { id: "payout", rawRequest: plan, amount: 5998, status: "PENDING" };
const request = { id: "claim", actorId: "marko", bankAccount: account, confirmPaid: true };
beforeEach(() => {
  vi.resetAllMocks();
  m.claim.mockResolvedValue({ id: "claim", orderId: "order", orderItemId: "item", quantity: 2, decision: "PRIHVACENA", resolution: "POVRAT_NOVCA", status: "U_OBRADI", order: { channel: "SPC" } });
  m.receipts.mockResolvedValue([{ qty: 1, warehouseId: "dc" }, { qty: 1, warehouseId: "dc" }]);
  m.lines.mockResolvedValue([{ id: "sale", qty: 4, refundedQty: 0, unitPriceGross: 2999 }]);
  m.payout.mockResolvedValue(null);
  m.create.mockResolvedValue(payout);
  m.documents.mockResolvedValue([]);
  m.others.mockResolvedValue([]);
  m.issue.mockResolvedValue({ ok: true });
  m.tx.mockImplementation(fn => fn(db));
});
it("prepares 5998 RSD for the two received tables without completing the payout", async () => {
  await issueReclamationRefund(request);
  expect(m.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "PENDING", provider: "MANUAL", method: "UPLATA_NA_RACUN", rawRequest: plan }) });
  expect(m.issue).toHaveBeenCalledWith(expect.objectContaining({ quantities: { sale: 2 }, manualPaymentRefundId: "payout", paymentReturnMethod: "UPLATA_NA_RACUN" }));
  expect(m.close).not.toHaveBeenCalled();
});
it("requires physical receipt and explicit confirmation of the original buyer payment", async () => {
  m.receipts.mockResolvedValue([{ qty: 1, warehouseId: "dc" }]);
  await expect(issueReclamationRefund(request)).rejects.toThrow("prijem svih");
  expect(m.create).not.toHaveBeenCalled();
  m.receipts.mockResolvedValue([{ qty: 2, warehouseId: "dc" }]);
  await expect(issueReclamationRefund({ ...request, confirmPaid: false })).rejects.toThrow("kupac platio");
  expect(m.issue).not.toHaveBeenCalled();
});
it("does not reissue an already issued claim refund", async () => {
  m.payout.mockResolvedValue(payout);
  m.documents.mockResolvedValue([{ status: "ISSUED", totalGross: 5998, lines: [{ originalSaleLineId: "sale", qty: 2 }] }]);
  expect(await issueReclamationRefund(request)).toMatchObject({ alreadyIssued: true });
  expect(m.issue).not.toHaveBeenCalled();
  expect(m.create).not.toHaveBeenCalled();
});
it("does not mark the transfer completed when fiscal issuance failed or is uncertain", async () => {
  m.issue.mockResolvedValue({ ok: false, error: "Proverite Badi" });
  await expect(issueReclamationRefund(request)).rejects.toThrow("Proverite Badi");
  expect(m.close).not.toHaveBeenCalled();
  expect(m.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }));
});
it("rejects payout confirmation without the exact issued fiscal quantity", async () => {
  m.payout.mockResolvedValue(payout);
  m.documents.mockResolvedValue([{ status: "ISSUED", totalGross: 5998, lines: [{ originalSaleLineId: "sale", qty: 1 }] }]);
  await expect(confirmReclamationPayout({ id: "claim", actorId: "marko", paidAt: "2026-01-01", reference: "nalog-1", confirmed: true })).rejects.toThrow("celu količinu");
  expect(m.close).not.toHaveBeenCalled();
});
it("closes the claim only after an explicit confirmed bank transfer", async () => {
  m.payout.mockResolvedValue(payout);
  m.documents.mockResolvedValue([{ status: "ISSUED", totalGross: 5998, lines: [{ originalSaleLineId: "sale", qty: 2 }] }]);
  await confirmReclamationPayout({ id: "claim", actorId: "marko", paidAt: "2026-01-01", reference: "nalog-1", confirmed: true });
  expect(m.update).toHaveBeenCalledWith({ where: { id: "payout" }, data: expect.objectContaining({ status: "COMPLETED", providerRef: "nalog-1" }) });
  expect(m.close).toHaveBeenCalledWith({ where: { id: "claim" }, data: expect.objectContaining({ status: "RESENO" }) });
});
