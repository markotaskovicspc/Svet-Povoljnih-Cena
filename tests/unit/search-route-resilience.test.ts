import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimitJson: vi.fn(),
  searchProducts: vi.fn(),
  logOperationalError: vi.fn(),
}));

vi.mock("@/lib/api/search", () => ({
  searchProducts: mocks.searchProducts,
}));

vi.mock("@/lib/monitoring", () => ({
  logOperationalError: mocks.logOperationalError,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  RATE_LIMITS: { search: { limit: 120, windowMs: 60_000 } },
  checkRateLimitForRequest: mocks.checkRateLimit,
  rateLimitJson: mocks.rateLimitJson,
}));

import { GET } from "@/app/api/search/route";

beforeEach(() => {
  mocks.checkRateLimit.mockResolvedValue({ ok: true });
  mocks.searchProducts.mockResolvedValue([]);
  mocks.rateLimitJson.mockImplementation(
    () => Response.json({ ok: false, error: "rate_limited" }, { status: 429 }),
  );
});

describe("full search route resilience", () => {
  it("normalizes invalid pagination and disables response caching", async () => {
    const response = await GET(
      new Request(
        "https://example.invalid/api/search?q=cube&limit=invalid&offset=-20",
      ),
    );

    expect(mocks.searchProducts).toHaveBeenCalledWith("cube", 48, 0);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, hits: [] });
  });

  it("returns a retryable 503 for limiter or catalog failures", async () => {
    mocks.checkRateLimit.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(
      new Request("https://example.invalid/api/search?q=fotelja&limit=12"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "search_unavailable",
      hits: [],
    });
    expect(mocks.logOperationalError).toHaveBeenCalledWith(
      "api.search.failed",
      expect.any(Error),
      { queryLength: 7, limit: 12, offset: 0 },
    );
  });

  it("preserves the explicit rate-limit response", async () => {
    mocks.checkRateLimit.mockResolvedValue({ ok: false });

    const response = await GET(
      new Request("https://example.invalid/api/search?q=cube"),
    );

    expect(response.status).toBe(429);
    expect(mocks.rateLimitJson).toHaveBeenCalledOnce();
    expect(mocks.searchProducts).not.toHaveBeenCalled();
  });
});
