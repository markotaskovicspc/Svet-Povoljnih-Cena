import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ipsPaymentProvider,
  resetIpsTokenCacheForTesting,
} from "@/lib/payments/ips";

const gatewayEnv = {
  IPS_BASE_URL: "https://ips-gateway.example",
  IPS_USER_ID: "test-user",
  IPS_TID: "test-tid",
  IPS_PUBLIC_BASE_URL: "https://shop.example",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("IPS gateway token handling", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(gatewayEnv)) vi.stubEnv(name, value);
    resetIpsTokenCacheForTesting();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("clamps an implausibly long gateway token lifetime to 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ sessionToken: "token", tokenExpiryTime: 9_999_999 }))
        .mockResolvedValueOnce(jsonResponse({ qrCodeURL: "https://ips-gateway.example/pay/1" })),
    );

    const result = await ipsPaymentProvider.createPayment("SA-1", 1_000, "IPS");

    expect(result.expiresAt?.toISOString()).toBe("2026-07-20T12:00:00.000Z");
  });

  it("refreshes a rejected token once and retries a safe payment-start request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ sessionToken: "stale", tokenExpiryTime: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(jsonResponse({ sessionToken: "fresh", tokenExpiryTime: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ qrCodeURL: "https://ips-gateway.example/pay/2" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await ipsPaymentProvider.createPayment("SA-2", 2_000, "IPS");

    expect(result.redirectUrl).toBe("https://ips-gateway.example/pay/2");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer stale",
    });
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer fresh",
    });
  });
});
