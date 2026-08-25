import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  enqueueDueNewsletterCampaigns: vi.fn(),
  expirePartnerReservations: vi.fn(),
  disableInvalidRabaluxWebAvailability: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    backgroundJob: {
      findMany: mocks.findMany,
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    rateLimitBucket: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    paymentRefund: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    newsletterOptInToken: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("@/lib/newsletter/campaigns", () => ({
  enqueueDueNewsletterCampaigns: mocks.enqueueDueNewsletterCampaigns,
}));

vi.mock("@/lib/channel-availability.server", () => ({
  expirePartnerReservations: mocks.expirePartnerReservations,
  disableInvalidRabaluxWebAvailability:
    mocks.disableInvalidRabaluxWebAvailability,
}));

describe("background job priority", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.findMany.mockResolvedValue([]);
    mocks.enqueueDueNewsletterCampaigns.mockReset();
    mocks.enqueueDueNewsletterCampaigns.mockResolvedValue(0);
    mocks.expirePartnerReservations.mockReset();
    mocks.expirePartnerReservations.mockResolvedValue({ released: 0 });
    mocks.disableInvalidRabaluxWebAvailability.mockReset();
    mocks.disableInvalidRabaluxWebAvailability.mockResolvedValue(0);
  });

  it("selects customer-facing jobs before bulk Rabalux media", async () => {
    const { processPendingBackgroundJobs } = await import("@/lib/background-jobs");
    const result = await processPendingBackgroundJobs(20);

    expect(mocks.findMany).toHaveBeenCalledTimes(4);
    expect(mocks.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { kind: "NEWSLETTER_CAMPAIGN_SEND" },
      take: 5,
    });
    expect(mocks.findMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        kind: {
          in: expect.arrayContaining([
            "PASSWORD_RESET_EMAIL",
            "BUYER_RECEIPT",
          ]),
        },
      },
      take: 20,
    });
    expect(mocks.findMany.mock.calls[2]?.[0]).toMatchObject({
      where: {
        kind: {
          notIn: expect.arrayContaining([
            "NEWSLETTER_CAMPAIGN_SEND",
            "RABALUX_MEDIA_PRODUCT",
          ]),
        },
      },
      take: 20,
    });
    expect(mocks.findMany.mock.calls[3]?.[0]).toMatchObject({
      where: { kind: "RABALUX_MEDIA_PRODUCT" },
      take: 20,
    });
    expect(result.selected).toBe(0);
  });
});
