import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkPaymentStatus,
  findOrder,
  checkIpLimit,
  checkOrderLimit,
  operationalError,
  TestIpsConfigError,
} = vi.hoisted(() => ({
  checkPaymentStatus: vi.fn(),
  findOrder: vi.fn(),
  checkIpLimit: vi.fn(),
  checkOrderLimit: vi.fn(),
  operationalError: vi.fn(),
  TestIpsConfigError: class extends Error {},
}));

vi.mock("@/lib/payments", () => ({
  IpsConfigError: TestIpsConfigError,
  ipsPaymentProvider: { checkPaymentStatus },
}));

vi.mock("@/lib/db", () => ({
  db: { order: { findFirst: findOrder } },
}));

vi.mock("@/lib/monitoring", () => ({
  logOperationalError: operationalError,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  RATE_LIMITS: {
    ipsCallback: { limit: 60, windowMs: 60_000 },
    ipsCallbackOrder: { limit: 6, windowMs: 600_000 },
  },
  checkRateLimitForRequest: checkIpLimit,
  checkRateLimit: checkOrderLimit,
  rateLimitKey: (scope: string, value: string) => `${scope}:${value}`,
  getClientIp: () => "203.0.113.10",
}));

import { POST } from "@/app/api/payment/ips/callback/route";

function callback(body: unknown) {
  return POST(
    new Request("https://shop.example/api/payment/ips/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("IPS callback wake-up endpoint", () => {
  beforeEach(() => {
    checkIpLimit.mockResolvedValue({ ok: true });
    checkOrderLimit.mockResolvedValue({ ok: true });
    findOrder.mockReset();
    checkPaymentStatus.mockReset();
  });

  it("acknowledges a forged order id without a gateway call or database mutation", async () => {
    findOrder.mockResolvedValue(null);

    const response = await callback({ orderId: "RANDOM-FORGED-ID" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(checkPaymentStatus).not.toHaveBeenCalled();
    expect(findOrder).toHaveBeenCalledTimes(1);
  });

  it("funnels a real pending IPS order through the server-side status check", async () => {
    findOrder.mockResolvedValue({
      id: "order-id",
      number: "SA-2026-0001",
      payments: [{ status: "PENDING" }],
    });
    checkPaymentStatus.mockResolvedValue({ paid: true });

    const response = await callback({ orderId: "SA-2026-0001", responseCode: "forged" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, paid: true });
    expect(checkOrderLimit).toHaveBeenCalledWith(
      "ipsCallbackOrder:order-id",
      expect.any(Object),
    );
    expect(checkPaymentStatus).toHaveBeenCalledWith("SA-2026-0001");
  });

  it("does not recheck a payment that is already settled", async () => {
    findOrder.mockResolvedValue({
      id: "order-id",
      number: "SA-2026-0001",
      payments: [{ status: "PAID" }],
    });

    const response = await callback({ orderId: "SA-2026-0001" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, paid: true });
    expect(checkPaymentStatus).not.toHaveBeenCalled();
  });

  it("always acknowledges throttled and temporarily misconfigured callbacks", async () => {
    checkIpLimit.mockResolvedValueOnce({ ok: false });
    expect((await callback({ orderId: "SA-2026-0001" })).status).toBe(200);
    expect(findOrder).not.toHaveBeenCalled();

    checkIpLimit.mockResolvedValueOnce({ ok: true });
    findOrder.mockResolvedValueOnce({
      id: "order-id",
      number: "SA-2026-0001",
      payments: [{ status: "PENDING" }],
    });
    checkPaymentStatus.mockRejectedValueOnce(new TestIpsConfigError("not configured"));

    const response = await callback({ orderId: "SA-2026-0001" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(operationalError).toHaveBeenCalledWith(
      "payment.ips.callback_not_configured",
      expect.any(TestIpsConfigError),
      expect.any(Object),
    );
  });
});
