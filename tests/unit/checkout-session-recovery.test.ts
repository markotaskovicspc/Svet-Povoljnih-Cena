import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  getCurrentUser: vi.fn(),
  checkRateLimitForRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    checkoutSession: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimitForRequest: mocks.checkRateLimitForRequest,
  rateLimitJson: vi.fn(),
  RATE_LIMITS: { checkout: { limit: 100, windowMs: 60_000 } },
}));

import { POST } from "@/app/api/checkout/session/route";

const cartLine = {
  sku: "ERGO-LUX",
  name: "Ergo Lux stolica",
  slug: "ergo-lux-stolica",
  qty: 1,
  unitPriceFull: 2_856,
  unitPriceSale: 2_001,
};

function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/checkout/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "checkoutsession123",
      step: "shipping",
      identity: "guest",
      guestEmail: "kupac@example.com",
      recoveryConsent: true,
      lineCount: 1,
      itemQty: 1,
      cartTotal: 2_001,
      lines: [cartLine],
      ...overrides,
    }),
  });
}

describe("checkout recovery capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T10:00:00.000Z"));
    mocks.findUnique.mockReset().mockResolvedValue(null);
    mocks.upsert.mockReset().mockResolvedValue({});
    mocks.getCurrentUser.mockReset().mockResolvedValue(null);
    mocks.checkRateLimitForRequest.mockReset().mockResolvedValue({ ok: true });
  });

  afterEach(() => vi.useRealTimers());

  it("stores the cart and schedules the first reminder one hour after explicit consent", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          guestEmail: "kupac@example.com",
          recoveryConsent: true,
          recoveryConsentAt: new Date("2026-09-01T10:00:00.000Z"),
          recoveryNextSendAt: new Date("2026-09-01T11:00:00.000Z"),
          recoveryStep: 0,
          cartSnapshot: [cartLine],
        }),
      }),
    );
  });

  it("stops a scheduled sequence immediately when the cart is emptied", async () => {
    mocks.findUnique.mockResolvedValue({
      recoveryConsent: true,
      recoveryConsentAt: new Date("2026-09-01T09:00:00.000Z"),
      recoveryStep: 1,
    });

    await POST(
      request({ lines: [], lineCount: 0, itemQty: 0, cartTotal: 0 }),
    );

    expect(mocks.upsert.mock.calls[0]?.[0].update).toMatchObject({
      recoveryConsent: false,
      recoveryConsentAt: null,
      recoveryNextSendAt: null,
      recoveryStoppedAt: new Date("2026-09-01T10:00:00.000Z"),
      recoveryStopReason: "empty_cart",
      cartSnapshot: [],
    });
  });

  it("starts from step one again only after a fresh explicit opt-in", async () => {
    mocks.findUnique.mockResolvedValue({
      recoveryConsent: false,
      recoveryConsentAt: null,
      recoveryStep: 3,
    });

    await POST(request());

    expect(mocks.upsert.mock.calls[0]?.[0].update).toMatchObject({
      recoveryConsent: true,
      recoveryStep: 0,
      recoveryConsentAt: new Date("2026-09-01T10:00:00.000Z"),
      recoveryNextSendAt: new Date("2026-09-01T11:00:00.000Z"),
      recoveryStoppedAt: null,
      recoveryStopReason: null,
    });
  });
});
