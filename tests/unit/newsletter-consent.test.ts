import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    user: { update: vi.fn() },
    session: { deleteMany: vi.fn() },
    account: { deleteMany: vi.fn() },
    address: { deleteMany: vi.fn() },
    savedCard: { deleteMany: vi.fn() },
    wishlistItem: { deleteMany: vi.fn() },
    backInStockAlert: { deleteMany: vi.fn() },
    onSaleAlert: { deleteMany: vi.fn() },
    marketingConsent: { deleteMany: vi.fn(), updateMany: vi.fn() },
    comment: { deleteMany: vi.fn() },
    reclamation: { updateMany: vi.fn() },
    newsletterSubscriber: { deleteMany: vi.fn(), updateMany: vi.fn() },
    marketingContact: { update: vi.fn() },
    marketingConsentEvent: { create: vi.fn() },
    backgroundJob: { upsert: vi.fn() },
  };
  return {
    tx,
    contactByEmail: vi.fn(),
    contactForAccount: vi.fn(),
    userByEmail: vi.fn(),
    userById: vi.fn(),
    enqueueBackgroundJob: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    marketingContact: {
      findUnique: mocks.contactByEmail,
      findFirst: mocks.contactForAccount,
    },
    user: {
      findFirst: mocks.userByEmail,
      findUnique: mocks.userById,
    },
    $transaction: (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
  },
}));

vi.mock("@/lib/background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueueBackgroundJob,
}));

import { softDeleteAccount } from "@/lib/auth/gdpr";
import { withdrawMarketingEmail } from "@/lib/newsletter/contacts";

describe("newsletter consent consistency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const delegate of Object.values(mocks.tx)) {
      for (const method of Object.values(delegate)) {
        method.mockResolvedValue({ count: 1 });
      }
    }
    mocks.enqueueBackgroundJob.mockResolvedValue({ id: "job-1", status: "QUEUED" });
  });

  it("withdraws canonical, account and legacy email consent together", async () => {
    mocks.contactByEmail.mockResolvedValue({
      id: "contact-1",
      userId: "user-1",
      status: "ACTIVE",
    });
    mocks.userByEmail.mockResolvedValue({ id: "user-1" });

    await withdrawMarketingEmail(" USER@EXAMPLE.COM ", "provider-preference");

    expect(mocks.tx.marketingContact.update).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: expect.objectContaining({ status: "UNSUBSCRIBED" }),
    });
    expect(mocks.tx.marketingConsent.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { email: false },
    });
    expect(mocks.tx.newsletterSubscriber.updateMany).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      data: expect.objectContaining({ consent: false }),
    });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: "NEWSLETTER_SYNC",
      payload: { email: "user@example.com", subscriptionIntent: "withdraw" },
    }));
  });

  it("deactivates and detaches the marketing contact during account deletion", async () => {
    mocks.userById.mockResolvedValue({ email: "user@example.com" });
    mocks.contactForAccount.mockResolvedValue({ id: "contact-1", status: "ACTIVE" });

    await softDeleteAccount("user-1");

    expect(mocks.tx.marketingContact.update).toHaveBeenCalledWith({
      where: { id: "contact-1" },
      data: expect.objectContaining({
        status: "UNSUBSCRIBED",
        userId: null,
        firstName: null,
        lastName: null,
      }),
    });
    expect(mocks.tx.marketingConsentEvent.create).toHaveBeenCalledWith({
      data: {
        contactId: "contact-1",
        type: "WITHDRAWN",
        source: "account-deletion",
      },
    });
    expect(mocks.tx.backgroundJob.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { idempotencyKey: "account-deletion-unsubscribe:user-1" },
    }));
  });
});
