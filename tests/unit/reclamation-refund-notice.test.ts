import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { queueReclamationRefundNotice, queueReclamationFiscalRefund } from "@/lib/admin/reclamation-refund-notice.server";

const mocks = vi.hoisted(() => ({ claim: vi.fn(), receipt: vi.fn(), dispatch: vi.fn(), payout: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { reclamation: { findUnique: mocks.claim }, stockMovement: { findMany: mocks.receipt }, paymentRefund: { findUnique: mocks.payout } } }));
vi.mock("@/lib/email/tracking", () => ({ trackedDispatch: mocks.dispatch }));
vi.mock("@/lib/email/config", () => ({ getEmailConfig: mocks.config }));
import { sendReclamationRefundOfficeNotice } from "@/lib/email/reclamation-refund-notice";

const claim = { id: "claim-1", number: "R-1-SPC-2026-000001", orderId: "order-1", order: { number: "SPC-2026-000001", channel: "SPC" }, orderItemId: "item",
  product: { name: '<Sto & stolica>' }, sku: "110177", quantity: 2, decision: "PRIHVACENA", resolution: "POVRAT_NOVCA", status: "U_OBRADI" };
const receipt = { id: "receipt-1", qty: 2, createdAt: new Date("2026-10-12T21:00:00Z"), warehouse: { code: "DC", name: "DC" } };
const createMany = vi.fn();
const findJob = vi.fn();
const findEmail = vi.fn();
const updateJob = vi.fn();
const tx = { reclamation: { findUnique: mocks.claim }, stockMovement: { findMany: mocks.receipt }, paymentRefund: { findUnique: mocks.payout },
  backgroundJob: { createMany, findUnique: findJob, updateMany: updateJob }, emailMessage: { findUnique: findEmail } } as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.claim.mockResolvedValue(claim);
  mocks.receipt.mockResolvedValue([receipt]);
  mocks.config.mockReturnValue({ provider: "ses", reclamationRefundNotificationTo: "podrska@svetpovoljnihcena.rs", baseUrl: "https://www.svetpovoljnihcena.rs/" });
  mocks.payout.mockResolvedValue({ amount: 5998, status: "PENDING" });
  mocks.dispatch.mockResolvedValue({ ok: true, provider: "ses", id: "mail-1" });
  createMany.mockResolvedValue({ count: 1 });
  findJob.mockResolvedValue({ id: "job-1", status: "QUEUED" });
});

describe("refund notice eligibility and durable attribution", () => {
  it("queues an accepted refund only after a stock receipt exists", async () => {
    mocks.receipt.mockResolvedValueOnce([]);
    expect(await queueReclamationRefundNotice(tx, claim.id)).toBeNull();
    expect(createMany).not.toHaveBeenCalled();
    expect(await queueReclamationRefundNotice(tx, claim.id)).toBe("job-1");
    expect(createMany).toHaveBeenCalledExactlyOnceWith({ data: { kind: "RECLAMATION_REFUND_OFFICE_EMAIL", payload: { reclamationId: claim.id },
      idempotencyKey: "reclamation-refund-support:claim-1" }, skipDuplicates: true });
  });

  it.each([
    { resolution: "ZAMENA_ARTIKLA" }, { resolution: "ZAMENA_DELA" }, { resolution: "POPUST" },
    { decision: "CEKA" }, { decision: "ODBIJENA" }, { status: "ODBIJENO" }, { status: "RESENO" },
  ])("does not notify for ineligible decisions: %j", async override => {
    mocks.claim.mockResolvedValue({ ...claim, ...override });
    expect(await queueReclamationRefundNotice(tx, claim.id)).toBeNull();
    await sendReclamationRefundOfficeNotice(claim.id);
    expect(createMany).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("waits for the entire return when parcels arrive separately", async () => {
    mocks.receipt.mockResolvedValue([{ ...receipt, qty: 1 }]);
    expect(await queueReclamationRefundNotice(tx, claim.id)).toBeNull();
    await sendReclamationRefundOfficeNotice(claim.id);
    expect(createMany).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    mocks.receipt.mockResolvedValue([{ ...receipt, qty: 1 }, { ...receipt, id: "receipt-2", qty: 1 }]);
    expect(await queueReclamationRefundNotice(tx, claim.id)).toBe("job-1");
    await sendReclamationRefundOfficeNotice(claim.id);
    expect(mocks.dispatch.mock.calls[0][0].text).toContain("Primljeno komada: 2");
    expect(mocks.dispatch.mock.calls[0][0].metadata.receiptIds).toEqual(["receipt-1", "receipt-2"]);
    expect(mocks.receipt).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [
      { idempotencyKey: "reclamation-return:claim-1" },
      { idempotencyKey: { startsWith: "reclamation-return:claim-1:parcel:" } },
    ] } }));
  });

  it("keeps the same queue key on repeated intake, and never re-arms an already sent notice", async () => {
    createMany.mockResolvedValue({ count: 0 });
    findJob.mockResolvedValue({ id: "job-1", status: "COMPLETED" });
    findEmail.mockResolvedValue({ status: "DELIVERED", providerMessageId: "mail-1" });
    expect(await queueReclamationRefundNotice(tx, claim.id)).toBeNull();
    expect(updateJob).not.toHaveBeenCalled();
  });

  it("re-arms a skipped job when refund approval is restored after intake", async () => {
    findJob.mockResolvedValue({ id: "job-1", status: "COMPLETED" });
    findEmail.mockResolvedValue(null);
    expect(await queueReclamationRefundNotice(tx, claim.id)).toBe("job-1");
    expect(updateJob).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "QUEUED", attempts: 0, payload: { reclamationId: claim.id } }) }));
  });
});

describe("office refund email", () => {
  it("sends the actual intake quantity, ERP link and escaped item name to support with a stable email key", async () => {
    await sendReclamationRefundOfficeNotice(claim.id);
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      to: "podrska@svetpovoljnihcena.rs", idempotencyKey: "reclamation-refund-support:claim-1",
      html: expect.stringContaining("&lt;Sto &amp; stolica&gt;"),
      text: expect.stringContaining("Primljeno komada: 2"),
      metadata: { reclamationId: claim.id, orderId: "order-1", receiptId: "receipt-1", receiptIds: ["receipt-1"] },
    }));
    expect(mocks.dispatch.mock.calls[0][0].html).toContain("/admin/erp/reklamacije-dnevnik/claim-1");
    expect(mocks.dispatch.mock.calls[0][0].text).toContain("ne potvrđuje da je novac isplaćen");
    expect(mocks.dispatch.mock.calls[0][0].text).toContain("proverite da li je kupcu novac već vraćen");
  });

  it("requires an actual intake even if warehouse preparation is READY", async () => {
    mocks.claim.mockResolvedValue({ ...claim, warehouseStatus: "READY" });
    mocks.receipt.mockResolvedValue([]);
    await sendReclamationRefundOfficeNotice(claim.id);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("fails for missing configuration instead of completing an unsent notice", async () => {
    mocks.config.mockReturnValue({ provider: "none" });
    await expect(sendReclamationRefundOfficeNotice(claim.id)).rejects.toThrow("nije podešen");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("propagates provider failure so the durable worker retries", async () => {
    mocks.payout.mockResolvedValue({ amount: 5998, status: "PENDING" });
  mocks.dispatch.mockResolvedValue({ ok: false, provider: "ses", error: "Temporary SES failure" });
    await expect(sendReclamationRefundOfficeNotice(claim.id)).rejects.toThrow("Temporary SES failure");
  });
});

describe("automatic fiscal refund queue", () => {
  it("commits a stable fiscal job only after the whole approved claim arrives", async () => {
    mocks.receipt.mockResolvedValueOnce([{ ...receipt, qty: 1 }]);
    expect(await queueReclamationFiscalRefund(tx, claim.id)).toBeNull();
    expect(createMany).not.toHaveBeenCalled();
    expect(await queueReclamationFiscalRefund(tx, claim.id)).toBe("job-1");
    expect(createMany).toHaveBeenCalledExactlyOnceWith({ data: { kind: "RECLAMATION_FISCAL_REFUND", payload: { reclamationId: claim.id }, idempotencyKey: "reclamation-fiscal-refund:claim-1" }, skipDuplicates: true });
  });
  it.each([{ resolution: "ZAMENA_ARTIKLA" }, { decision: "CEKA" }, { status: "RESENO" }, { orderItemId: null }, { order: { channel: "ANANAS" } }])("never refunds an ineligible intake: %j", override => {
    mocks.claim.mockResolvedValue({ ...claim, ...override });
    return expect(queueReclamationFiscalRefund(tx, claim.id)).resolves.toBeNull();
  });
  it("does not replay a completed job, but lets a corrected failed intake be retried", async () => {
    findJob.mockResolvedValueOnce({ id: "job-1", status: "COMPLETED" });
    expect(await queueReclamationFiscalRefund(tx, claim.id)).toBeNull();
    expect(updateJob).not.toHaveBeenCalled();
    findJob.mockResolvedValueOnce({ id: "job-1", status: "FAILED" });
    expect(await queueReclamationFiscalRefund(tx, claim.id)).toBe("job-1");
    expect(updateJob).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "job-1", status: "FAILED" }, data: expect.objectContaining({ status: "QUEUED" }) }));
  });
});
