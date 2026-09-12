import { describe, expect, it } from "vitest";
import { androidArIntent, arPlatform, getProductArAsset, productArShareUrl } from "@/lib/product-ar";

describe("product AR", () => {
  it("only enables the original brown CUBE", () => {
    expect(getProductArAsset("100010-6b45ec")?.dimensionsCm).toEqual({ w: 80, d: 80, h: 71 });
    expect(getProductArAsset("100010-ec1aa0")).toBeUndefined();
    expect(getProductArAsset("toString")).toBeUndefined();
  });
  it("keeps the reachable origin and drops unrelated query data from QR links", () => {
    expect(productArShareUrl("https://preview.trycloudflare.com/p/100010-6b45ec?utm_source=test#gallery"))
      .toBe("https://preview.trycloudflare.com/ar/100010-6b45ec");
  });
  it("uses an HTTPS preview for a desktop localhost QR without changing public links", () => {
    expect(productArShareUrl("http://localhost:3024/p/100010-6b45ec", "https://preview.trycloudflare.com"))
      .toBe("https://preview.trycloudflare.com/ar/100010-6b45ec");
    expect(productArShareUrl("https://www.svetpovoljnihcena.rs/p/100010-6b45ec", "https://preview.trycloudflare.com"))
      .toBe("https://www.svetpovoljnihcena.rs/ar/100010-6b45ec");
  });
  it("builds Android AR-only links with a manual fallback on the reachable origin", () => {
    const intent = androidArIntent(getProductArAsset("100010-6b45ec")!, "https://preview.trycloudflare.com/ar/100010-6b45ec");
    expect(intent).toContain("mode=ar_only");
    expect(intent).toContain("resizable=false");
    expect(intent).toContain(encodeURIComponent(getProductArAsset("100010-6b45ec")!.glbUrl));
    expect(intent).not.toContain("preview.trycloudflare.com%2Fmodels");
    expect(intent).toContain(encodeURIComponent("https://preview.trycloudflare.com/ar/100010-6b45ec?manual=1"));
  });
  it("distinguishes desktop, Android, and iPad desktop-mode Safari", () => {
    expect(arPlatform("Mozilla Macintosh", 0)).toBe("desktop");
    expect(arPlatform("Mozilla Macintosh", 5)).toBe("ios");
    expect(arPlatform("Mozilla iPhone")).toBe("ios");
    expect(arPlatform("Mozilla Android")).toBe("android");
  });
});
