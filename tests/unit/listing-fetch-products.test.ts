import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchListingPage } from "@/lib/listing/fetch-products";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listing API retry", () => {
  it("retries a transient server failure and returns the recovered page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ ok: true, items: [], nextCursor: null, total: 18 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchListingPage(
      new URLSearchParams("priceMin=2000&priceMax=10000"),
      undefined,
      0,
    );

    expect(result.total).toBe(18);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a client-side query error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchListingPage(new URLSearchParams("priceMin=broken"), undefined, 0),
    ).rejects.toThrow("HTTP 400");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
