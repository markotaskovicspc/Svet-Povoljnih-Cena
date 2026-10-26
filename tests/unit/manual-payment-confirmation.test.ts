import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentStatus, Prisma } from "@prisma/client";
import { paymentConfirmationSchema } from "@/lib/payments/payment-confirmation";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.enqueue }));
import { setManualSalesOrderPayment } from "@/lib/admin/manual-payment.server";

type Receipt = {
  id: string; status: PaymentStatus; paidAt: Date | null;
  providerRef?: string | null; rawResponse?: Prisma.JsonValue;
};
const input = {
  orderId: "manual-order", orderNumber: "MP-2026-000123",
  paymentMethod: "UPLATA_NA_RACUN" as const, paid: true,
  amount: 3652, currency: "RSD",
};

function fixture(initial: Receipt | null = { id: "payment", status: "PENDING", paidAt: null }) {
  let receipt = initial;
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    backgroundJob: { findUnique: vi.fn().mockResolvedValue(null) },
    payment: {
      findFirst: vi.fn(async () => receipt ? { ...receipt } : null),
      update: vi.fn(async ({ data }: { data: { status: PaymentStatus; paidAt: Date | null } }) => {
        receipt = { ...receipt!, ...data }; return { id: receipt.id };
      }),
      create: vi.fn(async ({ data }: { data: { status: PaymentStatus; paidAt: Date | null } }) => {
        receipt = { id: "new-payment", ...data }; return { id: receipt.id };
      }),
    },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient, receipt: () => receipt };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockImplementation(async ({ payload }) => {
    paymentConfirmationSchema.parse(payload);
    return { id: "confirmation", status: "QUEUED" };
  });
});

describe("manual customer bank-transfer confirmation", () => {
  it("queues the first PAID transition in the same locked transaction with the actual receipt identity", async () => {
    const f = fixture();
    await setManualSalesOrderPayment(f.client, input);
    expect(f.tx.$queryRaw.mock.calls[0][0].text).toContain('FROM "Order"');
    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.payment.findFirst.mock.invocationCallOrder[0]);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      kind: "BANK_PAYMENT_EMAIL", idempotencyKey: "bank-payment-email:manual:payment",
      payload: { source: "MANUAL", orderId: input.orderId, paymentId: "payment",
        orderNumber: input.orderNumber, amountMinor: 365200, currency: "RSD" },
    }, f.client);
    expect(f.tx.payment.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.enqueue.mock.invocationCallOrder[0]);
    expect(f.tx.backgroundJob.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "bank-payment-email:manual:payment" }, select: { id: true },
    });
    expect(f.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(f.tx.backgroundJob.findUnique.mock.invocationCallOrder[0]);
    expect(f.tx.backgroundJob.findUnique.mock.invocationCallOrder[0]).toBeLessThan(mocks.enqueue.mock.invocationCallOrder[0]);
  });

  it("also queues a newly created receipt that is explicitly marked paid", async () => {
    const f = fixture(null);
    await setManualSalesOrderPayment(f.client, { ...input, currency: "EUR", amount: 12.34 });
    expect(f.tx.payment.create).toHaveBeenCalledOnce();
    expect(mocks.enqueue.mock.calls[0][0]).toMatchObject({
      idempotencyKey: "bank-payment-email:manual:new-payment",
      payload: { paymentId: "new-payment", amountMinor: 1234, currency: "EUR" },
    });
  });

  it("does not resend on repeated saves or price edits of the same paid receipt", async () => {
    const f = fixture();
    await setManualSalesOrderPayment(f.client, input);
    const paidAt = f.receipt()!.paidAt;
    await setManualSalesOrderPayment(f.client, input);
    await setManualSalesOrderPayment(f.client, { ...input, amount: 4000 });
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(f.receipt()!.paidAt).toBe(paidAt);
  });

  it.each([
    { ...input, paid: false },
    { ...input, amount: 0 },
    { ...input, paymentMethod: "POUZECE_GOTOVINA" as const },
    { ...input, paymentMethod: "POUZECE_KARTICA" as const },
  ])("does not issue a bank-transfer receipt for unpaid, zero or COD input: %j", async (args) => {
    await setManualSalesOrderPayment(fixture().client, args);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each(["PAID", "REFUNDED", "PARTIAL_REFUND"] as const)("does not confirm an already received/refunded payment again: %s", async (status) => {
    await setManualSalesOrderPayment(fixture({ id: "payment", status, paidAt: null }).client, input);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not resend a payment already confirmed by bank import, including a subsequently unchecked receipt", async () => {
    const bankReceipt = { id: "payment", status: "PAID" as const, paidAt: new Date(),
      providerRef: "FT26273LJRRX", rawResponse: { bankAccount: "340000100028300451", statement: "225" } };
    const f = fixture(bankReceipt);
    await setManualSalesOrderPayment(f.client, input);
    await setManualSalesOrderPayment(f.client, { ...input, paid: false });
    await setManualSalesOrderPayment(f.client, input);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not attempt a duplicate insert when a manually paid receipt is unchecked and checked again", async () => {
    const f = fixture();
    await setManualSalesOrderPayment(f.client, input);
    f.tx.backgroundJob.findUnique.mockResolvedValue({ id: "confirmation" });
    await setManualSalesOrderPayment(f.client, { ...input, paid: false });
    await setManualSalesOrderPayment(f.client, input);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(f.tx.backgroundJob.findUnique).toHaveBeenCalledTimes(2);
    expect(f.receipt()!.status).toBe("PAID");
  });

  it("retains a durable existing receipt job without calling the insert/P2002 path", async () => {
    const f = fixture();
    f.tx.backgroundJob.findUnique.mockResolvedValue({ id: "existing-confirmation" });
    mocks.enqueue.mockRejectedValue(new Error("duplicate insert would abort the transaction"));
    await expect(setManualSalesOrderPayment(f.client, input)).resolves.toBeUndefined();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(f.receipt()!.status).toBe("PAID");
  });

  it("propagates an outbox failure so the enclosing payment transaction can roll back", async () => {
    mocks.enqueue.mockRejectedValue(new Error("outbox unavailable"));
    await expect(setManualSalesOrderPayment(fixture().client, input)).rejects.toThrow("outbox unavailable");
  });

  it("serializes concurrent saves on the order lock before checking the previous payment", async () => {
    const f = fixture();
    let tail = Promise.resolve();
    const transaction = async () => {
      let unlock = () => {};
      const tx = { ...f.tx, $queryRaw: vi.fn(async () => {
        const previous = tail;
        tail = new Promise<void>((resolve) => { unlock = resolve; });
        await previous;
        return [];
      }) };
      try { await setManualSalesOrderPayment(tx as unknown as Prisma.TransactionClient, input); }
      finally { unlock(); }
    };
    await Promise.all([transaction(), transaction()]);
    expect(f.tx.payment.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
  });
});
