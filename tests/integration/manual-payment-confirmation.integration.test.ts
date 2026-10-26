import { createHash, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Only the final external delivery boundary is mocked. PostgreSQL, transactions,
// outbox insertion, worker claims and email tracking all use the real application.
const transport = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/lib/email/transport", () => ({ dispatch: transport.dispatch }));

import { db, getDatabaseConnectionString } from "@/lib/db";
import { setManualSalesOrderPayment } from "@/lib/admin/manual-payment.server";
import { confirmWebOrderBankTransfer } from "@/lib/admin/web-order-bank-payment.server";
import { processBackgroundJob } from "@/lib/background-jobs";
import { reconcileBankEntry } from "@/lib/payments/bank-statements.server";
import { bankEntrySchema } from "@/lib/payments/bank-statements";
import { paymentConfirmationSchema } from "@/lib/payments/payment-confirmation";

// Explicit opt-in, plus an exact localhost target check before any fixture write.
// Run with the existing integration config and DATABASE_URL pointing to this DB.
const enabled = process.env.MANUAL_PAYMENT_PG_QA === "1";
if (enabled) {
  const target = new URL(getDatabaseConnectionString() ?? "");
  if (target.hostname !== "127.0.0.1" || target.port !== "55438" ||
      target.pathname !== "/spc_payment_price_qa_test" || target.searchParams.get("schema")) {
    throw new Error("Manual-payment PostgreSQL QA requires the dedicated localhost:55438/spc_payment_price_qa_test database.");
  }
}

type Fixture = { id: string; number: string; email: string };
const fixtures: Fixture[] = [];
const trackedJobIds = new Set<string>();
const prefix = `manual-payment-qa-${randomUUID()}`;
type PaymentOverrides = Partial<Pick<Parameters<typeof setManualSalesOrderPayment>[1],
  "paid" | "amount" | "currency" | "paymentMethod">>;

async function fixture(bankNumber = false, channel: "MP" | "WEB" = "MP"): Promise<Fixture> {
  const number = bankNumber ? `SPC-2026-${randomInt(1_000_000).toString().padStart(6, "0")}`
    : `MP-QA-${randomUUID()}`;
  const email = `${prefix}-${fixtures.length}@example.invalid`;
  const order = await db.order.create({ data: {
    number, channel, status: "KREIRANO", subtotal: "1234.56", total: "1234.56",
    paymentMethod: "UPLATA_NA_RACUN", shippingMethod: "KURIR", guestEmail: email,
    shipFirstName: "Local QA", shipLastName: "Payment", shipPhone: "000000000",
    shipStreet: "QA only", shipCity: "QA", shipPostalCode: "00000", shipCountry: "RS",
    termsAcceptedAt: new Date(), notes: prefix,
  }, select: { id: true, number: true } });
  const result = { ...order, email }; fixtures.push(result); return result;
}

async function save(order: Fixture, overrides: PaymentOverrides = {}) {
  return db.$transaction(async tx => {
    await setManualSalesOrderPayment(tx, {
      orderId: order.id, orderNumber: order.number, paymentMethod: "UPLATA_NA_RACUN",
      paid: true, amount: 1234.56, currency: "RSD", ...overrides,
    });
    // A caught PostgreSQL unique violation would leave this very transaction
    // aborted (25P02); assert a query still succeeds before committing it.
    expect(await tx.$queryRaw<Array<{ probe: number }>>`SELECT 1::int AS probe`).toEqual([{ probe: 1 }]);
  }, { maxWait: 10_000, timeout: 20_000 });
}

async function payment(order: Fixture) {
  return db.payment.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
}

async function confirmationJobs(order: Fixture) {
  const jobs = await db.backgroundJob.findMany({
    where: { kind: "BANK_PAYMENT_EMAIL", payload: { path: ["orderId"], equals: order.id } },
  });
  for (const job of jobs) trackedJobIds.add(job.id);
  return jobs;
}

function bankEntry(order: Fixture) {
  return bankEntrySchema.parse({ account: "340000100028300451", statement: "999", date: "2026-10-26",
    bankReference: `FT${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
    orderNumber: order.number, amountMinor: 123456, currency: "RSD",
    sourceHash: createHash("sha256").update(order.id).digest("hex"),
  });
}

async function collectBankJobs(ids: string[]) {
  ids.forEach(id => trackedJobIds.add(id));
}

async function webFixture(currency = "RSD", amount = "1234.56") {
  const order = await fixture(true, "WEB");
  const receipt = await db.payment.create({ data: {
    orderId: order.id, method: "UPLATA_NA_RACUN", provider: "MANUAL", status: "PENDING", currency, amount,
  } });
  const input = { orderId: order.id, paymentId: receipt.id, paidAt: new Date("2026-10-26T10:00:00Z"),
    statementReference: `LOCAL-QA-${receipt.id}`, note: prefix, actorId: "local-qa-operator" };
  return { order, receipt, input };
}

describe.skipIf(!enabled)("manual payment confirmation on real local PostgreSQL", () => {
  beforeAll(async () => {
    vi.stubEnv("EMAIL_PROVIDER", "none");
    const identity = await db.$queryRaw<Array<{ name: string; version: string }>>
      `SELECT current_database() AS name, version() AS version`;
    expect(identity[0].name).toBe("spc_payment_price_qa_test");
    expect(identity[0].version).toContain("PostgreSQL 17");
  });

  beforeEach(() => {
    transport.dispatch.mockReset();
    transport.dispatch.mockImplementation(async () => ({ ok: true, provider: "none", id: `local-qa-${randomUUID()}` }));
  });

  afterAll(async () => {
    const orderIds = fixtures.map(order => order.id);
    const numbers = fixtures.map(order => order.number);
    const paymentRows = await db.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await db.emailMessage.deleteMany({ where: { OR: numbers.map(number => ({ tags: { path: ["order"], equals: number } })) } });
    await db.backgroundJob.deleteMany({ where: { OR: [
      { id: { in: [...trackedJobIds] } },
      ...orderIds.map(id => ({ payload: { path: ["orderId"], equals: id } })),
      ...numbers.map(number => ({ payload: { path: ["orderNumber"], equals: number } })),
      { idempotencyKey: { in: paymentRows.map(row => `bank-payment-email:manual:${row.id}`) } },
    ] } });
    await db.order.deleteMany({ where: { id: { in: orderIds }, notes: prefix } });
    await db.$disconnect();
  });

  it("commits the first PAID receipt and queues its exact amount without sending inside the mutation", async () => {
    const order = await fixture();
    await save(order);
    const receipt = await payment(order);
    expect(receipt).toMatchObject({ status: "PAID", method: "UPLATA_NA_RACUN", provider: "MANUAL", currency: "RSD" });
    expect(receipt.amount.toFixed(2)).toBe("1234.56"); expect(receipt.paidAt).not.toBeNull();
    const jobs = await confirmationJobs(order);
    expect(jobs).toHaveLength(1); expect(jobs[0].status).toBe("QUEUED");
    expect(paymentConfirmationSchema.parse(jobs[0].payload)).toEqual({ source: "MANUAL", orderId: order.id,
      orderNumber: order.number, paymentId: receipt.id, amountMinor: 123456, currency: "RSD" });
    expect(transport.dispatch).not.toHaveBeenCalled();
  });

  it("repeated paid saves preserve receipt identity and create only one real outbox row", async () => {
    const order = await fixture(); await save(order);
    const before = await payment(order);
    await save(order); await save(order);
    const after = await payment(order);
    expect(after.id).toBe(before.id); expect(after.paidAt).toEqual(before.paidAt);
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await confirmationJobs(order)).toHaveLength(1);
  });

  it("commits paid/unpaid/paid replay with a usable transaction, not a caught 25P02", async () => {
    const order = await fixture(); await save(order);
    const [originalJob] = await confirmationJobs(order);
    await save(order, { paid: false });
    expect((await payment(order)).status).toBe("PENDING");
    await save(order);
    expect((await payment(order)).status).toBe("PAID");
    const jobs = await confirmationJobs(order);
    expect(jobs).toHaveLength(1); expect(jobs[0].id).toBe(originalJob.id);
  });

  it("serializes concurrent saves with real PostgreSQL row locks", async () => {
    const order = await fixture();
    await Promise.all([save(order), save(order), save(order)]);
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect(await confirmationJobs(order)).toHaveLength(1);
    expect((await payment(order)).status).toBe("PAID");
  });

  it("runs the real worker once and never resends after completed-job replay", async () => {
    const order = await fixture(); await save(order);
    const receipt = await payment(order); const [job] = await confirmationJobs(order);
    const result = await processBackgroundJob(job.id);
    const processed = await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(result, processed.lastError ?? "worker result").toEqual({ claimed: true, ok: true });
    expect(transport.dispatch).toHaveBeenCalledOnce();
    expect(transport.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      to: order.email, bcc: ["podrska@svetpovoljnihcena.rs"],
      text: expect.stringContaining("1.234,56 din"), idempotencyKey: `bank-payment:manual:${receipt.id}`,
    }));
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETED");
    expect(await processBackgroundJob(job.id)).toEqual({ claimed: false });
    await save(order, { paid: false }); await save(order);
    expect(await processBackgroundJob(job.id)).toEqual({ claimed: false });
    expect(transport.dispatch).toHaveBeenCalledOnce();
    expect(await db.backgroundJob.count({ where: { idempotencyKey: job.idempotencyKey } })).toBe(1);
    const emails = await db.emailMessage.findMany({ where: { idempotencyKey: `bank-payment:manual:${receipt.id}` } });
    expect(emails).toHaveLength(1); expect(emails[0]).toMatchObject({ status: "SENT", provider: "none", recipient: order.email });
  });

  it.each([
    { paid: false }, { amount: 2000 }, { currency: "EUR" }, { paymentMethod: "POUZECE_GOTOVINA" as const },
  ])("completes a stale queued snapshot without dispatch after correction %j", async correction => {
    const order = await fixture(); await save(order);
    const receipt = await payment(order); const [job] = await confirmationJobs(order);
    await save(order, correction);
    expect(await processBackgroundJob(job.id)).toEqual({ claimed: true, ok: true });
    expect(transport.dispatch).not.toHaveBeenCalled();
    expect(await db.emailMessage.count({ where: { idempotencyKey: `bank-payment:manual:${receipt.id}` } })).toBe(0);
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("COMPLETED");
  });

  it("rolls the payment and outbox insertion back together", async () => {
    const order = await fixture();
    await expect(db.$transaction(async tx => {
      await setManualSalesOrderPayment(tx, { orderId: order.id, orderNumber: order.number,
        paymentMethod: "UPLATA_NA_RACUN", paid: true, amount: 1234.56, currency: "RSD" });
      expect(await tx.payment.count({ where: { orderId: order.id } })).toBe(1);
      expect(await tx.backgroundJob.count({ where: { kind: "BANK_PAYMENT_EMAIL", payload: { path: ["orderId"], equals: order.id } } })).toBe(1);
      throw new Error("intentional local QA rollback");
    })).rejects.toThrow("intentional local QA rollback");
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(0);
    expect(await confirmationJobs(order)).toHaveLength(0);
    expect(transport.dispatch).not.toHaveBeenCalled();
  });

  it("does not add a manual confirmation after the bank importer recorded the receipt", async () => {
    const order = await fixture(true); const entry = bankEntry(order);
    await collectBankJobs(await reconcileBankEntry(entry));
    await save(order); await save(order, { paid: false }); await save(order);
    const jobs = await confirmationJobs(order);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotencyKey).toBe(`bank-payment-email:${entry.account}:${entry.bankReference}`);
    expect((await payment(order)).providerRef).toBe(entry.bankReference);
    await processBackgroundJob(jobs[0].id);
    expect(transport.dispatch).toHaveBeenCalledOnce();
  });

  it("keeps the bank importer from adding a second customer confirmation after manual payment", async () => {
    const order = await fixture(true); const entry = bankEntry(order);
    await save(order); await collectBankJobs(await reconcileBankEntry(entry));
    const jobs = await confirmationJobs(order);
    expect(jobs).toHaveLength(1); expect(jobs[0].idempotencyKey).toContain("bank-payment-email:manual:");
    expect(await db.backgroundJob.count({ where: { kind: "BANK_PAYMENT_REVIEW_EMAIL", payload: { path: ["orderNumber"], equals: order.number } } })).toBe(1);
    await processBackgroundJob(jobs[0].id);
    expect(transport.dispatch).toHaveBeenCalledOnce();
  });

  it("shares the real order lock with a concurrent bank import", async () => {
    const order = await fixture(true); const entry = bankEntry(order);
    const [, bankJobs] = await Promise.all([save(order), reconcileBankEntry(entry)]);
    await collectBankJobs(bankJobs);
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect((await payment(order)).status).toBe("PAID");
    const jobs = await confirmationJobs(order); expect(jobs).toHaveLength(1);
    await processBackgroundJob(jobs[0].id);
    expect(transport.dispatch).toHaveBeenCalledOnce();
  });

  it("atomically confirms the existing WEB receipt, status event and exact-currency outbox without changing order status", async () => {
    // WEB already permits a receipt amount different from the order total;
    // extraction and email queuing must not introduce a new accounting rule.
    const { order, receipt, input } = await webFixture("EUR", "98.76");
    expect(await confirmWebOrderBankTransfer(input)).toEqual({ orderNumber: order.number, amount: 98.76, currency: "EUR" });
    expect(await db.payment.findUniqueOrThrow({ where: { id: receipt.id } })).toMatchObject({
      status: "PAID", paidAt: input.paidAt, providerRef: input.statementReference,
    });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("KREIRANO");
    expect(await db.orderStatusEvent.findMany({ where: { orderId: order.id } })).toEqual([
      expect.objectContaining({ actorId: input.actorId, status: "KREIRANO", note: expect.stringContaining("98.76 EUR") }),
    ]);
    const jobs = await confirmationJobs(order); expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotencyKey).toBe(`bank-payment-email:manual:${receipt.id}`);
    expect(paymentConfirmationSchema.parse(jobs[0].payload)).toEqual({ source: "MANUAL", orderId: order.id,
      orderNumber: order.number, paymentId: receipt.id, amountMinor: 9876, currency: "EUR" });
    expect(transport.dispatch).not.toHaveBeenCalled();
    expect(await processBackgroundJob(jobs[0].id)).toEqual({ claimed: true, ok: true });
    expect(transport.dispatch).toHaveBeenCalledWith(expect.objectContaining({ to: order.email, text: expect.stringContaining("98,76 EUR") }));
  });

  it("rejects repeated WEB confirmation without another status event or outbox insertion", async () => {
    const { order, input } = await webFixture();
    await confirmWebOrderBankTransfer(input);
    await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow("već potvrđena");
    expect(await db.orderStatusEvent.count({ where: { orderId: order.id } })).toBe(1);
    expect(await confirmationJobs(order)).toHaveLength(1);
    expect(transport.dispatch).not.toHaveBeenCalled();
  });

  it.each(["cancelled-status", "cancelled-at", "foreign-receipt"])("rejects invalid WEB confirmation %s without payment/event/outbox changes", async reason => {
    const { order, receipt, input } = await webFixture();
    if (reason === "cancelled-status") await db.order.update({ where: { id: order.id }, data: { status: "OTKAZANO" } });
    if (reason === "cancelled-at") await db.order.update({ where: { id: order.id }, data: { cancelledAt: new Date() } });
    if (reason === "foreign-receipt") input.paymentId = (await webFixture()).receipt.id;
    await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow(reason === "foreign-receipt" ? "Evidencija uplate nije pronađena" : "otkazanoj");
    expect((await db.payment.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe("PENDING");
    expect(await db.orderStatusEvent.count({ where: { orderId: order.id } })).toBe(0);
    expect(await confirmationJobs(order)).toHaveLength(0);
    expect(transport.dispatch).not.toHaveBeenCalled();
  });

  it.each(["event", "outbox"])("rolls back WEB payment and event on a real PostgreSQL %s insertion failure", async failure => {
    const { order, receipt, input } = await webFixture();
    const table = failure === "event" ? "OrderStatusEvent" : "BackgroundJob";
    const column = failure === "event" ? "orderId" : "idempotencyKey";
    const blockedValue = failure === "event" ? order.id : `bank-payment-email:manual:${receipt.id}`;
    const constraint = `qa_web_payment_${randomUUID().replaceAll("-", "")}`;
    // Names and values originate solely from this strictly local QA fixture.
    // A real CHECK violation exercises rollback without mocking a DB operation.
    const literal = `'${blockedValue.replaceAll("'", "''")}'`;
    await db.$executeRaw(Prisma.raw(`ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}" CHECK ("${column}" <> ${literal})`));
    try {
      await expect(confirmWebOrderBankTransfer(input)).rejects.toThrow();
      const after = await db.payment.findUniqueOrThrow({ where: { id: receipt.id } });
      expect(after).toMatchObject({ status: "PENDING", paidAt: null, providerRef: null });
      expect(await db.orderStatusEvent.count({ where: { orderId: order.id } })).toBe(0);
      expect(await confirmationJobs(order)).toHaveLength(0);
      expect(transport.dispatch).not.toHaveBeenCalled();
    } finally {
      await db.$executeRaw(Prisma.raw(`ALTER TABLE "${table}" DROP CONSTRAINT "${constraint}"`));
    }
    await confirmWebOrderBankTransfer(input);
    expect((await payment(order)).status).toBe("PAID");
    expect(await confirmationJobs(order)).toHaveLength(1);
  });

  it("reuses one payment/job/email identity when the WEB QA order becomes MP and is toggled unpaid/paid", async () => {
    const { order, receipt, input } = await webFixture();
    await confirmWebOrderBankTransfer(input); const [job] = await confirmationJobs(order);
    await processBackgroundJob(job.id);
    await db.order.update({ where: { id: order.id }, data: { channel: "MP" } });
    await save(order, { paid: false }); await save(order);
    expect((await payment(order)).id).toBe(receipt.id);
    expect(await db.backgroundJob.count({ where: { idempotencyKey: job.idempotencyKey } })).toBe(1);
    expect(await processBackgroundJob(job.id)).toEqual({ claimed: false });
    expect(transport.dispatch).toHaveBeenCalledOnce();
    expect(await db.emailMessage.count({ where: { idempotencyKey: `bank-payment:manual:${receipt.id}` } })).toBe(1);
  });

  it("serializes concurrent WEB/manual confirmation onto the same receipt and outbox key", async () => {
    const { order, receipt, input } = await webFixture();
    const [web, manual] = await Promise.allSettled([confirmWebOrderBankTransfer(input), save(order)]);
    expect(manual.status).toBe("fulfilled");
    if (web.status === "rejected") expect(String(web.reason)).toContain("već potvrđena");
    expect((await payment(order)).id).toBe(receipt.id);
    const jobs = await confirmationJobs(order); expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotencyKey).toBe(`bank-payment-email:manual:${receipt.id}`);
    await processBackgroundJob(jobs[0].id);
    expect(transport.dispatch).toHaveBeenCalledOnce();
  });

  it("serializes concurrent WEB/bank confirmation without two customer receipts", async () => {
    const { order, input } = await webFixture(); const entry = bankEntry(order);
    const [web, bank] = await Promise.allSettled([confirmWebOrderBankTransfer(input), reconcileBankEntry(entry)]);
    expect(bank.status).toBe("fulfilled");
    if (bank.status === "fulfilled") await collectBankJobs(bank.value);
    if (web.status === "rejected") expect(String(web.reason)).toContain("već potvrđena");
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
    expect((await payment(order)).status).toBe("PAID");
    const jobs = await confirmationJobs(order); expect(jobs).toHaveLength(1);
    await processBackgroundJob(jobs[0].id);
    expect(transport.dispatch).toHaveBeenCalledOnce();
  });
});
