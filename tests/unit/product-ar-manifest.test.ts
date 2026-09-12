import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/product-ar/[slug]/route";
import { getProductArAsset } from "@/lib/product-ar";

describe("current AR manifest", () => {
  it("returns the current immutable files without caching the manifest", async () => {
    const response = await GET(new Request("https://example.test/api/product-ar/100010-6b45ec"), {
      params: Promise.resolve({ slug: "100010-6b45ec" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(getProductArAsset("100010-6b45ec"));
  });
  it("does not enable unregistered products or inherited object keys", async () => {
    for (const slug of ["missing", "constructor", "toString"]) {
      const response = await GET(new Request("https://example.test"), { params: Promise.resolve({ slug }) });
      expect(response.status).toBe(404);
      expect(await response.json()).toBeNull();
    }
  });
});
