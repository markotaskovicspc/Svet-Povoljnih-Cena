import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  subscribe: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/api/newsletter", async () => {
  const { z } = await import("zod");
  return {
    subscribeSchema: z.object({ email: z.email(), source: z.string().optional() }),
    subscribeNewsletter: mocks.subscribe,
  };
});

vi.mock("@/lib/security/rate-limit", () => ({
  RATE_LIMITS: { newsletter: { limit: 5, windowMs: 60_000 } },
  checkRateLimitForRequest: mocks.rateLimit,
  rateLimitJson: () => Response.json({ ok: false }, { status: 429 }),
}));

import * as newsletterRoute from "@/app/api/newsletter/route";

describe("public newsletter route privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimit.mockResolvedValue({ ok: true });
  });

  it.each(["active", "pending", "suppressed"])(
    "returns the same response for %s addresses",
    async (status) => {
      mocks.subscribe.mockResolvedValue({ ok: true, status });
      const response = await newsletterRoute.POST(request());
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toEqual({ ok: true });
    },
  );

  it("does not expose an opt-in delivery failure", async () => {
    mocks.subscribe.mockRejectedValue(new Error("provider unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await newsletterRoute.POST(request());
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("does not export the former email-only DELETE handler", () => {
    expect("DELETE" in newsletterRoute).toBe(false);
  });
});

function request() {
  return new Request("https://example.test/api/newsletter", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", source: "footer" }),
  });
}
