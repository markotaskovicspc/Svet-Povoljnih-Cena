import { afterEach, beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { optimizedIconUrl } from "@/lib/media/optimized-icon";
import { GET } from "@/app/api/media/icon/route";
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("rewrites only own public raster icons, never private or external URLs", () => {
  const base = "https://project.supabase.co/storage/v1/object/public/";
  expect(optimizedIconUrl(`${base}product-media/pictograms/a.png`)).toBe("/api/media/icon?key=pictograms%2Fa.png");
  for (const url of [`${base}product-media/pictograms/a.svg`, `${base}fiscal-receipts/1.png`, `${base}product-media/products/a.png`, "https://other.supabase.co/storage/v1/object/public/product-media/pictograms/a.png", "https://project.supabase.co/storage/v1/object/sign/product-media/pictograms/a.png?token=secret"]) {
    expect(optimizedIconUrl(url)).toBe(url);
  }
});
it("rejects traversal, private buckets and unsupported formats before fetching", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  for (const key of ["fiscal-receipts/1.png", "pictograms/../private.png", "pictograms/a.svg", "https://evil.example/a.png", "pictograms/a.png?x=1"]) {
    expect((await GET(new Request(`https://shop.example/api/media/icon?key=${encodeURIComponent(key)}`))).status).toBe(400);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("returns a bounded WebP with long browser/CDN caching", async () => {
  const input = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 40, g: 100, b: 90, alpha: 0.8 } } }).png().toBuffer();
  const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array(input), { headers: { "content-type": "image/png" } })); vi.stubGlobal("fetch", fetch);
  const response = await GET(new Request("https://shop.example/api/media/icon?key=pictograms%2Fa.png"));
  expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("cache-control")).toContain("s-maxage=31536000");
  const output = Buffer.from(await response.arrayBuffer()); const meta = await sharp(output).metadata();
  expect(meta.width).toBe(256); expect(meta.height).toBe(192); expect(meta.hasAlpha).toBe(true); expect(output.length).toBeLessThan(input.length);
  expect(fetch).toHaveBeenCalledWith("https://project.supabase.co/storage/v1/object/public/product-media/pictograms/a.png", expect.objectContaining({ redirect: "error" }));
});
it("falls back to the same public asset if conversion fails without caching the error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid image")));
  const response = await GET(new Request("https://shop.example/api/media/icon?key=mobile-shortcuts/a.png"));
  expect(response.status).toBe(307); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("location")).toBe("https://project.supabase.co/storage/v1/object/public/product-media/mobile-shortcuts/a.png");
});
