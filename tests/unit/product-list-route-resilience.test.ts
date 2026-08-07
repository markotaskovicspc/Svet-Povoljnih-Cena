import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProducts: vi.fn(),
  logOperationalError: vi.fn(),
}));

vi.mock("@/lib/api/catalog", () => ({
  listProducts: mocks.listProducts,
}));

vi.mock("@/lib/monitoring", () => ({
  logOperationalError: mocks.logOperationalError,
}));

import { GET } from "@/app/api/products/route";

beforeEach(() => {
  mocks.listProducts.mockReset();
  mocks.logOperationalError.mockReset();
  mocks.listProducts.mockResolvedValue({
    items: [],
    nextCursor: null,
    total: 0,
  });
});

describe("product listing route resilience", () => {
  it("uses strict catalog reads and disables response caching", async () => {
    const response = await GET(
      new Request(
        "https://example.invalid/api/products?categoryPath=%2Fnamestaj&priceMin=2000&priceMax=10000",
      ),
    );

    expect(mocks.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryPath: "/namestaj",
        priceRange: [2000, 10000],
      }),
      { throwOnError: true },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns retryable 503 instead of a false empty result", async () => {
    mocks.listProducts.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(
      new Request("https://example.invalid/api/products?categoryPath=%2Fnamestaj"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "products_unavailable",
      total: 0,
    });
    expect(mocks.logOperationalError).toHaveBeenCalledOnce();
  });
});
