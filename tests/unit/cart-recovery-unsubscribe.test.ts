import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    checkoutSession: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));

import { applyEmailUnsubscribe } from "@/lib/email/unsubscribe";

describe("cart recovery unsubscribe", () => {
  beforeEach(() => {
    mocks.findUnique.mockReset().mockResolvedValue({
      userId: null,
      guestEmail: "kupac@example.com",
      user: null,
    });
    mocks.updateMany.mockReset().mockResolvedValue({ count: 2 });
  });

  it("stops every active recovery for the email without changing newsletter state", async () => {
    const result = await applyEmailUnsubscribe({
      purpose: "cart_recovery",
      sessionId: "checkoutsession123",
      email: "KUPAC@example.com",
    });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        guestEmail: { equals: "kupac@example.com", mode: "insensitive" },
        status: "ACTIVE",
      },
      data: expect.objectContaining({
        recoveryConsent: false,
        recoveryConsentAt: null,
        recoveryNextSendAt: null,
        recoveryStopReason: "unsubscribed",
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      kind: "cart_recovery",
      changed: 2,
    });
  });
});
