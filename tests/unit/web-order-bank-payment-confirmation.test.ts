import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { paymentConfirmationSchema } from "@/lib/payments/payment-confirmation";

const mocks = vi.hoisted(() => ({
  lock: vi.fn(), order: vi.fn(), payment: vi.fn(), update: vi.fn(), event: vi.fn(),
  job: vi.fn(), enqueue: vi.fn(),
}));
const tx = {
  $queryRaw: mocks.lock,
  order: { findUnique: mocks.order },
  payment: { findFirst: mocks.payment, updateMany: mocks.update },
  orderStatusEvent: { create: mocks.event },
  backgroundJob: { findUnique: mocks.job },
};
vi.mock("@/lib/db", () => ({ db: {
  $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
} }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.enqueue }));
import { confirmWebOrderBankTransfer } from "@/lib/admin/web-order-bank-payment.server";

const input = {
  orderId: "web-order", paymentId: "bank-receipt", paidAt: new Date("2026-10-26T12:00:00Z"),
  statementReference: "225/approved-manually", note: "Izvod proveren", actorId: "operator",
};
const order = { id: input.orderId, number: "SPC-2026-001234", status: "KREIRANO",
  paymentMethod: "UPLATA_NA_RACUN", cancelledAt: null };
const payment = { id: input.paymentId, status: "PENDING", amount: new Prisma.Decimal("1234.56"), currency: "RSD" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.lock.mockResolvedValue([]);
  mocks.order.mockResolvedValue(order);
  mocks.payment.mockResolvedValue(payment);
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.event.mockResolvedValue({ id: "event" });
  mocks.job.mockResolvedValue(null);
  mocks.enqueue.mockImplementation(async ({ payload }) => {
    paymentConfirmationSchema.parse(payload);
    return { id: "confirmation", status: "QUEUED" };
  });
});

describe("WEB manually confirmed bank transfer", () => {
  it("records the existing receipt and event with the confirmation in the same locked transaction", async () => {
    expect(await confirmWebOrderBankTransfer(input)).toEqual({
      orderNumber: order.number, amount: 1234.56, currency: "RSD",
    });
    expect(mocks.lock.mock.calls[0][0].text).toContain('FROM "Order"');
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.payment.mock.invocationCallOrder[0]);
    expect(mocks.payment).toHaveBeenCalledWith({
      where: { id: input.paymentId, orderId: input.orderId, method: "UPLATA_NA_RACUN", provider: "MANUAL" },
      select: { id: true, status: true, amount: true, currency: true },
    });
    // Keep the existing amount, currency and provider: this action acknowledges
    // the stored receipt rather than rewriting it through the manual-order form.
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: input.paymentId, status: "PENDING" },
      data: { status: "PAID", paidAt: input.paidAt, providerRef: input.statementReference },
    });
    expect(mocks.event).toHaveBeenCalledWith({ data: {
      orderId: input.orderId, status: order.status, actorId: input.actorId,
      note: "Uplata na račun potvrđena (1234.56 RSD; ref. 225/approved-manually). Izvod proveren",
    } });
    expect(mocks.enqueue).toHaveBeenCalledWith({
      kind: "BANK_PAYMENT_EMAIL", idempotencyKey: `bank-payment-email:manual:${input.paymentId}`,
      payload: { source: "MANUAL", orderId: input.orderId, orderNumber: order.number,
        paymentId: input.paymentId, amountMinor: 123456, currency: "RSD" },
    }, tx);
    expect(mocks.event.mock.invocationCallOrder[0]).toBeLessThan(mocks.enqueue.mock.invocationCallOrder[0]);
  });

  it.each(["PAID", "REFUNDED", "PARTIAL_REFUND"])("keeps the existing refusal for an already processed payment (%s)", async status => {
    mocks.payment.mockResolvedValue({ ...payment, status });
    await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each([{ status: "OTKAZANO" }, { cancelledAt: new Date() }, { paymentMethod: "IPS" }])("does not record or notify a disallowed order: %j", async correction => {
    mocks.order.mockResolvedValue({ ...order, ...correction });
    await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow();
    expect(mocks.payment).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("rejects an unknown or foreign receipt before any payment write", async () => {
    mocks.payment.mockResolvedValue(null);
    await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow("Evidencija uplate nije pronađena");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue when the conditional payment transition loses its race", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow("Status uplate je u međuvremenu promenjen");
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("reuses the same durable manual-payment key after a previous WEB/manual confirmation", async () => {
    mocks.job.mockResolvedValue({ id: "previous-confirmation" });
    await expect(confirmWebOrderBankTransfer(input)).resolves.toMatchObject({ orderNumber: order.number });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("propagates a failed event write before scheduling any email", async () => {
    mocks.event.mockRejectedValue(new Error("event unavailable"));
    await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow("event unavailable");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("propagates an outbox failure to roll the enclosing payment and event transaction back", async () => {
    mocks.enqueue.mockRejectedValue(new Error("outbox unavailable"));
    await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow("outbox unavailable");
  });

  it("does not emit a positive-payment confirmation for a zero-valued stored receipt", async () => {
    mocks.payment.mockResolvedValue({ ...payment, amount: new Prisma.Decimal(0) });
    await expect(confirmWebOrderBankTransfer(input)).resolves.toMatchObject({ amount: 0 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
