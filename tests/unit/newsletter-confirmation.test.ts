import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  tx: {
    newsletterOptInToken: { findUnique: vi.fn(), updateMany: vi.fn() },
    marketingContact: { update: vi.fn() },
    newsletterSubscriber: { upsert: vi.fn() },
    marketingConsentEvent: { create: vi.fn() },
  },
  enqueue: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (tx: typeof mocks.tx) => unknown) => Promise.resolve(fn(mocks.tx)) } }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.enqueue }));
import { confirmNewsletterOptIn } from "@/lib/newsletter/contacts";
const token = "a".repeat(48);
function row(status = "PENDING", usedAt: Date | null = null) {
  return { id: "t", contactId: "c", usedAt, expiresAt: new Date(Date.now() + 60_000), contact: { email: "test@example.com", status, source: "footer" } };
}
beforeEach(() => { vi.resetAllMocks(); mocks.tx.newsletterOptInToken.updateMany.mockResolvedValue({ count: 1 }); });
it("confirms once and queues one grant", async () => {
  mocks.tx.newsletterOptInToken.findUnique.mockResolvedValue(row());
  expect((await confirmNewsletterOptIn(token)).ok).toBe(true);
  expect(mocks.tx.marketingContact.update).toHaveBeenCalledOnce();
  expect(mocks.tx.marketingConsentEvent.create).toHaveBeenCalledOnce();
  expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ payload: { email: "test@example.com", subscriptionIntent: "grant" } }));
});
it("accepts repeat clicks without writing or queueing another grant", async () => {
  mocks.tx.newsletterOptInToken.findUnique.mockResolvedValue(row("ACTIVE", new Date()));
  expect((await confirmNewsletterOptIn(token)).ok).toBe(true);
  expect(mocks.tx.marketingContact.update).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it.each(["UNSUBSCRIBED", "SUPPRESSED"])("never reactivates a used token for %s contacts", async status => {
  mocks.tx.newsletterOptInToken.findUnique.mockResolvedValue(row(status, new Date()));
  expect((await confirmNewsletterOptIn(token)).ok).toBe(false);
  expect(mocks.tx.marketingContact.update).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("rejects expired and malformed tokens", async () => {
  expect((await confirmNewsletterOptIn("invalid")).ok).toBe(false);
  expect(mocks.tx.newsletterOptInToken.findUnique).not.toHaveBeenCalled();
  mocks.tx.newsletterOptInToken.findUnique.mockResolvedValue({ ...row(), expiresAt: new Date(0) });
  expect(await confirmNewsletterOptIn(token)).toEqual({ ok: false, reason: "expired" });
  expect(mocks.tx.newsletterOptInToken.updateMany).not.toHaveBeenCalled();
});
it("does not grant consent when the atomic token claim loses a race", async () => {
  mocks.tx.newsletterOptInToken.findUnique.mockResolvedValue(row());
  mocks.tx.newsletterOptInToken.updateMany.mockResolvedValue({ count: 0 });
  expect((await confirmNewsletterOptIn(token)).ok).toBe(false);
  expect(mocks.tx.marketingContact.update).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
