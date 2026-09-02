import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  enqueueDueNewsletterCampaigns: vi.fn(),
  expirePartnerReservations: vi.fn(),
  disableInvalidRabaluxWebAvailability: vi.fn(),
  backgroundJobDeleteMany: vi.fn(),
  newsletterTokenDeleteMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    backgroundJob: {
      findMany: mocks.findMany,
      deleteMany: mocks.backgroundJobDeleteMany,
    },
    rateLimitBucket: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    paymentRefund: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    newsletterOptInToken: {
      deleteMany: mocks.newsletterTokenDeleteMany,
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
    mocks.backgroundJobDeleteMany.mockReset();
    mocks.backgroundJobDeleteMany.mockResolvedValue({ count: 0 });
    mocks.newsletterTokenDeleteMany.mockReset();
    mocks.newsletterTokenDeleteMany.mockResolvedValue({ count: 0 });
  });

  it("selects customer-facing jobs before bulk Rabalux media", async () => {
    const { processPendingBackgroundJobs } = await import("@/lib/background-jobs");
    const result = await processPendingBackgroundJobs(20, {
      now: new Date("2026-09-02T10:17:00.000Z"),
    });

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
    expect(mocks.disableInvalidRabaluxWebAvailability).not.toHaveBeenCalled();
    expect(mocks.backgroundJobDeleteMany).not.toHaveBeenCalled();
  });

  it("runs Rabalux validation hourly and retention only in the daily window", async () => {
    const { processPendingBackgroundJobs } = await import("@/lib/background-jobs");

    await processPendingBackgroundJobs(20, {
      now: new Date("2026-09-02T02:00:00.000Z"),
    });
    expect(mocks.disableInvalidRabaluxWebAvailability).toHaveBeenCalledTimes(1);
    expect(mocks.backgroundJobDeleteMany).not.toHaveBeenCalled();

    await processPendingBackgroundJobs(20, {
      now: new Date("2026-09-02T03:00:00.000Z"),
    });
    expect(mocks.disableInvalidRabaluxWebAvailability).toHaveBeenCalledTimes(2);
    expect(mocks.backgroundJobDeleteMany).toHaveBeenCalledTimes(1);
    expect(mocks.newsletterTokenDeleteMany).toHaveBeenCalledTimes(1);
  });
});
