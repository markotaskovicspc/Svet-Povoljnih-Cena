import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { paymentConfirmationSchema } from "@/lib/payments/payment-confirmation";

const mocks = vi.hoisted(() => ({ load: vi.fn(), dispatch: vi.fn(), payment: vi.fn(),
  claim: vi.fn(), job: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { payment: { findUnique: mocks.payment },
  backgroundJob: { updateMany: mocks.claim, findUnique: mocks.job, update: mocks.update } } }));
vi.mock("@/lib/channel-availability.server", () => ({ expirePartnerReservations: vi.fn(), disableInvalidRabaluxWebAvailability: vi.fn() }));
vi.mock("@/lib/email/adapt", () => ({ loadOrderForEmail: mocks.load }));
vi.mock("@/lib/email/tracking", () => ({ trackedDispatch: mocks.dispatch }));
import { sendBankPaymentConfirmation } from "@/lib/email/bank-payment";
import { processBackgroundJob } from "@/lib/background-jobs";

const manual = { source: "MANUAL" as const, orderId: "order", paymentId: "receipt",
  orderNumber: "MP-2026-000123", amountMinor: 123456, currency: "RSD" as const };
const bank = { account: "340000100028300451" as const, bankReference: "FT26273LJRRX",
  statement: "225", date: "2026-09-30", orderNumber: "SPC-2026-001139",
  amountMinor: 365200, currency: "RSD" as const, sourceHash: "a".repeat(64), orderId: "order" };
const receipt = () => ({ orderId: manual.orderId, status: "PAID", method: "UPLATA_NA_RACUN",
  provider: "MANUAL", amount: new Prisma.Decimal("1234.56"), currency: manual.currency });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ recipient: "buyer@example.test", order: {} });
  mocks.dispatch.mockResolvedValue({ ok: true, id: "synthetic", provider: "none" });
  mocks.payment.mockResolvedValue(receipt());
  mocks.claim.mockResolvedValue({ count: 1 });
  mocks.job.mockResolvedValue({ id: "confirmation", kind: "BANK_PAYMENT_EMAIL", payload: manual, attempts: 1, maxAttempts: 8 });
  mocks.update.mockResolvedValue({});
});

it("reuses the bank confirmation text and support copy without fabricated bank references", async () => {
  await sendBankPaymentConfirmation(paymentConfirmationSchema.parse(manual));
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
    to: "buyer@example.test", bcc: ["podrska@svetpovoljnihcena.rs"],
    subject: "Uplata evidentirana — MP-2026-000123",
    text: expect.stringContaining("1.234,56 din"),
    idempotencyKey: "bank-payment:manual:receipt",
    metadata: { source: "MANUAL", paymentId: "receipt" },
  }));
  expect(JSON.stringify(mocks.dispatch.mock.calls[0][0])).not.toMatch(/bankReference|statement|FT/);
  expect(mocks.payment).toHaveBeenCalledWith({ where: { id: manual.paymentId }, select: {
    orderId: true, status: true, method: true, provider: true, amount: true, currency: true,
  } });
  expect(mocks.payment.mock.invocationCallOrder[0]).toBeLessThan(mocks.dispatch.mock.invocationCallOrder[0]);
});

it("preserves existing bank-import payloads, metadata and email idempotency keys", async () => {
  expect(paymentConfirmationSchema.parse(bank)).toEqual(bank);
  await sendBankPaymentConfirmation(bank);
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
    idempotencyKey: "bank-payment:340000100028300451:FT26273LJRRX",
    metadata: { bankReference: bank.bankReference, statement: bank.statement },
    text: expect.stringContaining("3.652,00 din"),
  }));
  expect(mocks.payment).not.toHaveBeenCalled();
});

it("prints the actual foreign currency of manual INO receipts", async () => {
  mocks.payment.mockResolvedValue({ ...receipt(), currency: "EUR" });
  await sendBankPaymentConfirmation({ ...manual, currency: "EUR" });
  expect(mocks.dispatch.mock.calls[0][0].text).toContain("1.234,56 EUR");
  expect(mocks.dispatch.mock.calls[0][0].text).not.toContain(" din");
});

it("keeps the existing support-only fallback for a customer without email", async () => {
  mocks.load.mockResolvedValue({ recipient: null, order: {} });
  await sendBankPaymentConfirmation(manual);
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({
    to: "podrska@svetpovoljnihcena.rs", bcc: undefined,
  }));
});

it("requires a real manual receipt identity and still rejects malformed legacy bank entries", () => {
  expect(paymentConfirmationSchema.safeParse({ ...manual, paymentId: "" }).success).toBe(false);
  expect(paymentConfirmationSchema.safeParse({ ...bank, bankReference: "MANUAL" }).success).toBe(false);
});

it.each([
  ["missing", null],
  ["another order", { ...receipt(), orderId: "another-order" }],
  ["unpaid", { ...receipt(), status: "PENDING" }],
  ["refunded", { ...receipt(), status: "REFUNDED" }],
  ["another method", { ...receipt(), method: "POUZECE_GOTOVINA" }],
  ["another provider", { ...receipt(), provider: "COD" }],
  ["corrected amount", { ...receipt(), amount: new Prisma.Decimal("1234.55") }],
  ["corrected currency", { ...receipt(), currency: "EUR" }],
])("skips a %s manual receipt instead of sending a stale confirmation", async (_reason, payment) => {
  mocks.payment.mockResolvedValue(payment);
  expect(await sendBankPaymentConfirmation(manual)).toEqual({ skipped: "PAYMENT_CHANGED" });
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("completes a changed-receipt worker job without marking an email as sent or retrying it", async () => {
  mocks.payment.mockResolvedValue({ ...receipt(), status: "PENDING" });
  expect(await processBackgroundJob("confirmation")).toEqual({ claimed: true, ok: true });
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    status: "COMPLETED", payload: {}, lastError: null,
  }) }));
});

it("keeps a payment lookup failure retryable and never sends on an unavailable recheck", async () => {
  mocks.payment.mockRejectedValue(new Error("payment lookup unavailable"));
  expect(await processBackgroundJob("confirmation")).toMatchObject({ claimed: true, ok: false, exhausted: false });
  expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    status: "RETRY", lastError: expect.stringContaining("payment lookup unavailable"),
  }) }));
});
