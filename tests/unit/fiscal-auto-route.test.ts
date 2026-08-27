import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueEligibleOrdersForFiscalization: vi.fn(),
}));

vi.mock("@/lib/fiscal/auto-reconcile", () => ({
  enqueueEligibleOrdersForFiscalization: mocks.enqueueEligibleOrdersForFiscalization,
}));

import { GET } from "@/app/api/cron/fiscal-auto/route";

describe("fiscal auto cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    mocks.enqueueEligibleOrdersForFiscalization.mockResolvedValue({
      scanned: 0,
      eligible: 0,
      eligibleAdvance: 0,
      eligiblePickup: 0,
      queued: 0,
      skippedUnderpaid: 0,
      failed: 0,
    });
  });

  it("rejects requests without a cron bearer secret", async () => {
    const response = await GET(new Request("https://example.test/api/cron/fiscal-auto"));

    expect(response.status).toBe(401);
    expect(mocks.enqueueEligibleOrdersForFiscalization).not.toHaveBeenCalled();
  });

  it("runs the hourly scan with a bounded requested limit", async () => {
    const response = await GET(new Request(
      "https://example.test/api/cron/fiscal-auto?limit=75",
      { headers: { authorization: "Bearer cron-test-secret" } },
    ));

    expect(response.status).toBe(200);
    expect(mocks.enqueueEligibleOrdersForFiscalization).toHaveBeenCalledWith(75);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      summary: {
        scanned: 0,
        eligible: 0,
        eligibleAdvance: 0,
        eligiblePickup: 0,
        queued: 0,
        skippedUnderpaid: 0,
        failed: 0,
      },
    });
  });
});
