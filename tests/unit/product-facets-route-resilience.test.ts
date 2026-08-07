import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProductFacets: vi.fn(),
  logOperationalError: vi.fn(),
}));

vi.mock("@/lib/api/catalog", () => ({
  listProductFacets: mocks.listProductFacets,
}));

vi.mock("@/lib/monitoring", () => ({
  logOperationalError: mocks.logOperationalError,
}));

import { GET } from "@/app/api/products/facets/route";

beforeEach(() => {
  mocks.listProductFacets.mockReset();
  mocks.logOperationalError.mockReset();
  mocks.listProductFacets.mockResolvedValue({
    facets: { groups: [] },
    extents: { price: [0, 0] },
  });
});

describe("product facets route resilience", () => {
  it("disables caching for complete category facets", async () => {
    const response = await GET(
      new Request(
        "https://example.invalid/api/products/facets?categoryPath=%2Fsve-za-kucu%2Frasveta",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns a retryable 503 when the complete facet read fails", async () => {
    mocks.listProductFacets.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(
      new Request(
        "https://example.invalid/api/products/facets?categoryPath=%2Fsve-za-kucu%2Frasveta",
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(await response.json()).toEqual({
      ok: false,
      error: "product_facets_unavailable",
    });
    expect(mocks.logOperationalError).toHaveBeenCalledOnce();
  });
});
