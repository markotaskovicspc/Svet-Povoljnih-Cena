import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimitJson: vi.fn(),
  suggest: vi.fn(),
  logOperationalError: vi.fn(),
}));

vi.mock("@/lib/api/search", () => ({
  suggest: mocks.suggest,
}));

vi.mock("@/lib/monitoring", () => ({
  logOperationalError: mocks.logOperationalError,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  RATE_LIMITS: { search: { limit: 120, windowMs: 60_000 } },
  checkRateLimitForRequest: mocks.checkRateLimit,
  rateLimitJson: mocks.rateLimitJson,
}));

import { GET } from "@/app/api/search/suggest/route";

beforeEach(() => {
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.suggest.mockResolvedValue({ hits: [], degraded: false });
  mocks.rateLimitJson.mockImplementation(
    () => Response.json({ ok: false, error: "rate_limited" }, { status: 429 }),
  );
});

describe("search suggestion route", () => {
  it("returns degraded product results and normalizes an invalid limit", async () => {
    const hit = { type: "product", sku: "TEST-1", name: "Fotelja CUBE" };
    mocks.suggest.mockResolvedValue({ hits: [hit], degraded: true });

    const response = await GET(
      new Request(
        "https://example.invalid/api/search/suggest?q=cube&limit=not-a-number",
      ),
    );

    expect(mocks.suggest).toHaveBeenCalledWith("cube", 8);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-search-degraded")).toBe("navigation");
    expect(await response.json()).toEqual({
      ok: true,
      hits: [hit],
      degraded: true,
    });
  });

  it("returns a retryable 503 instead of an unhandled failure", async () => {
    mocks.suggest.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(
      new Request("https://example.invalid/api/search/suggest?q=fotelja&limit=6"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "search_unavailable",
      hits: [],
    });
    expect(mocks.logOperationalError).toHaveBeenCalledWith(
      "api.search_suggest.failed",
      expect.any(Error),
      { queryLength: 7, limit: 6 },
    );
  });

  it("preserves the explicit rate-limit response", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false });

    const response = await GET(
      new Request("https://example.invalid/api/search/suggest?q=cube"),
    );

    expect(response.status).toBe(429);
    expect(mocks.rateLimitJson).toHaveBeenCalledOnce();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
});
