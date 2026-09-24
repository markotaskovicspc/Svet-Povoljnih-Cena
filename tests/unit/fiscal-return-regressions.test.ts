import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  order: vi.fn(), tx: vi.fn(), lock: vi.fn(), lines: vi.fn(), lineUpdate: vi.fn(), aggregate: vi.fn(), warehouse: vi.fn(),
  documents: vi.fn(), document: vi.fn(), createDocument: vi.fn(), updateDocument: vi.fn(),
  movements: vi.fn(), adjust: vi.fn(), fiscalize: vi.fn(), payment: vi.fn(),
  refund: vi.fn(), createRefund: vi.fn(), ips: vi.fn(), job: vi.fn(), createJob: vi.fn(), updateJob: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: m.tx,
  order: { findUnique: m.order },
  warehouse: { findFirst: m.warehouse },
  fiscalDocumentLine: { findMany: m.lines, updateMany: m.lineUpdate, aggregate: m.aggregate },
  fiscalDocument: { findMany: m.documents, findUnique: m.document, create: m.createDocument, update: m.updateDocument },
  stockMovement: { findMany: m.movements },
  payment: { findFirst: m.payment },
  paymentRefund: { findFirst: m.refund, findUnique: m.refund, create: m.createRefund },
  backgroundJob: { findUnique: m.job, create: m.createJob, updateMany: m.updateJob },
} }));
vi.mock("@/lib/inventory", () => ({ adjustInventory: m.adjust }));
vi.mock("@/lib/fiscal/return-lock", () => ({ withOrderReturnLock: m.lock }));
vi.mock("@/lib/fiscal/transport", () => ({ fiscalize: m.fiscalize }));
vi.mock("@/lib/fiscal/pdf-storage", () => ({ uploadFiscalPdf: vi.fn() }));
vi.mock("@/lib/payments", () => ({ ipsPaymentProvider: { refundPayment: m.ips } }));
import { db } from "@/lib/db";
import { issueFiscalSale, issueFiscalRefund, recordFiscalPaymentRefund } from "@/lib/fiscal/issue";

const input = { fiscalLineIds: ["line"], quantities: { line: 1 }, paymentReturnMethod: "POUZECE_GOTOVINA" as const, warehouseId: "warehouse", buyerId: "20:TEST" };
const paymentInput = { orderId: "order", orderNumber: "SPC", fiscalDocumentId: "refund", amount: 100, actorId: null };
let refunded = 0;
beforeEach(() => {
  vi.clearAllMocks();
  refunded = 0;
  m.tx.mockImplementation(run => run(db));
  m.lock.mockImplementation((_id, run) => run());
  m.warehouse.mockResolvedValue({ id: "warehouse", name: "Magacin" });
  m.lines.mockImplementation(async () => [{
    id: "line", qty: 3, refundedQty: refunded, fiscalDocumentId: "sale", orderItemId: "item", productId: "product",
    sku: "SKU", shortName: "Artikal", unitPriceGross: 100, serviceGross: 0,
    fiscalDocument: { orderId: "order", order: { id: "order", number: "SPC" }, receiptNumber: "SALE-1" },
  }]);
  m.lineUpdate.mockImplementation(async ({ data }) => { refunded += data.refundedQty.increment; return { count: 1 }; });
  m.aggregate.mockImplementation(async () => ({ _sum: { refundedQty: refunded } }));
  m.documents.mockResolvedValue([]);
  m.document.mockResolvedValue(null);
  m.createDocument.mockImplementation(async ({ data }) => ({ ...data, id: "refund", lines: data.lines.create }));
  m.fiscalize.mockResolvedValue({ ok: true, receipt: { receiptNumber: "REFUND-1", fiscalizedAt: "2026-09-19T12:00:00Z", raw: {} } });
  m.movements.mockResolvedValue([{ qty: 1, idempotencyKey: "order-return:SPC:item:1", warehouseId: "warehouse" }]);
  m.payment.mockResolvedValue(null);
  m.refund.mockResolvedValue(null);
  m.job.mockResolvedValue(null);
  m.createJob.mockResolvedValue({ id: "payment-job" });
  m.ips.mockResolvedValue({ refunded: true });
});

describe("fiscal refund stock and dispatch", () => {
  it("issues exactly one unit without adding already received stock again", async () => {
    expect(await issueFiscalRefund(input)).toMatchObject({ ok: true, refundedGross: 100 });
    expect(m.fiscalize.mock.calls[0][0].lines[0].qty).toBe(1);
    expect(m.adjust).not.toHaveBeenCalled();
    expect(refunded).toBe(1);
    expect(m.createRefund).not.toHaveBeenCalled(); // unpaid COD
  });
  it("retains stock posting for a manual refund before physical receipt", async () => {
    m.movements.mockResolvedValue([]);
    await issueFiscalRefund(input);
    expect(m.adjust).toHaveBeenCalledWith(db, expect.objectContaining({ qtyDelta: 1 }));
  });
  it("uses a different fiscal reference for the next equal partial refund", async () => {
    await issueFiscalRefund(input);
    m.movements.mockResolvedValue([{ qty: 1, idempotencyKey: "order-return:SPC:item:1" }, { qty: 1, idempotencyKey: "order-return:SPC:item:2" }]);
    await issueFiscalRefund(input);
    expect(m.fiscalize.mock.calls[0][0].idempotencyKey).not.toBe(m.fiscalize.mock.calls[1][0].idempotencyKey);
    expect(refunded).toBe(2);
    expect(m.adjust).not.toHaveBeenCalled();
  });
  it("blocks redispatch after an uncertain response even if another failed request exists", async () => {
    m.documents.mockResolvedValue([{ dispatchedAt: null, error: "fiscal:config" }, { dispatchedAt: new Date(), error: "fiscal:network" }]);
    expect(await issueFiscalRefund(input)).toMatchObject({ ok: false, reason: "gateway_failure" });
    expect(m.fiscalize).not.toHaveBeenCalled();
  });
  it("rejects quantities beyond the unrefunded fiscal quantity", async () => {
    expect(await issueFiscalRefund({ ...input, quantities: { line: 4 } })).toMatchObject({ ok: false });
    expect(m.fiscalize).not.toHaveBeenCalled();
  });
  it("leaves stock and refunded quantities untouched on provider failure", async () => {
    m.fiscalize.mockResolvedValue({ ok: false, error: "fiscal:network" });
    expect(await issueFiscalRefund(input)).toMatchObject({ ok: false });
    expect(refunded).toBe(0);
    expect(m.adjust).not.toHaveBeenCalled();
    expect(m.createRefund).not.toHaveBeenCalled();
  });
});

describe("actual money return versus fiscal refund", () => {
  it("does not invent a money refund for unpaid COD", async () => {
    expect(await recordFiscalPaymentRefund({ ...paymentInput, method: "POUZECE_GOTOVINA" })).toBeNull();
    expect(m.createRefund).not.toHaveBeenCalled();
    expect(m.ips).not.toHaveBeenCalled();
  });
  it("automatically calls IPS only for a recorded payment", async () => {
    m.payment.mockResolvedValue({ method: "IPS", status: "PAID" });
    expect(await recordFiscalPaymentRefund({ ...paymentInput, method: "IPS" })).toBeNull();
    expect(m.ips).toHaveBeenCalledWith("SPC", 100, expect.objectContaining({ fiscalDocumentId: "refund" }));
  });
  it("keeps unsupported card refunds pending instead of falsely completed", async () => {
    m.payment.mockResolvedValue({ method: "KARTICA", status: "PAID" });
    expect(await recordFiscalPaymentRefund({ ...paymentInput, method: "KARTICA" })).toContain("ručnu potvrdu");
    expect(m.createRefund).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) }));
    expect(m.ips).not.toHaveBeenCalled();
  });
  it("does not retry unsupported money refunds that are already recorded", async () => {
    m.payment.mockResolvedValue({ method: "KARTICA", status: "PAID" });
    m.refund.mockResolvedValue({ status: "COMPLETED" });
    expect(await recordFiscalPaymentRefund({ ...paymentInput, method: "KARTICA" })).toBeNull();
    expect(m.createRefund).not.toHaveBeenCalled();
  });
  it("does not call IPS when payment is not confirmed", async () => {
    expect(await recordFiscalPaymentRefund({ ...paymentInput, method: "IPS" })).toContain("uplata nije potvrđena");
    expect(m.ips).not.toHaveBeenCalled();
  });
});

it("does not issue a second fiscal receipt for Ananas orders", async () => {
  m.order.mockResolvedValue({ id: "ananas-order", channel: "ANANAS", items: [] });
  expect(await issueFiscalSale({ orderId: "ananas-order" })).toMatchObject({ ok: false, error: expect.stringContaining("Ananas") });
  expect(m.fiscalize).not.toHaveBeenCalled();
  expect(m.createDocument).not.toHaveBeenCalled();
});
