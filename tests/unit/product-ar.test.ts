import { describe, expect, it } from "vitest";
import { androidChromeArIntent, androidArIntent, arPlatform, getProductArAsset, productArShareUrl } from "@/lib/product-ar";

describe("product AR", () => {
  it("only enables registered products with their own dimensions and files", () => {
    expect(getProductArAsset("100010-6b45ec")).toBeUndefined();
    expect(getProductArAsset("100010-9ce68e")?.dimensionsCm).toEqual({ w: 70, d: 48, h: 74 });
    expect(getProductArAsset("100010-9ce68e")?.glbUrl).toContain("x-desk-210027/x-desk-v3.glb");
    expect(getProductArAsset("100010-9ce68e")?.usdzUrl).toContain("x-desk-210027/x-desk-v3.usdz");
    expect(getProductArAsset("100010-ec1aa0")).toBeUndefined();
    expect(getProductArAsset("toString")).toBeUndefined();
  });
  it("keeps the reachable origin and drops unrelated query data from QR links", () => {
    expect(productArShareUrl("https://preview.trycloudflare.com/p/100010-9ce68e?utm_source=test#gallery"))
      .toBe("https://preview.trycloudflare.com/ar/100010-9ce68e");
  });
  it("uses an HTTPS preview for a desktop localhost QR without changing public links", () => {
    expect(productArShareUrl("http://localhost:3024/p/100010-9ce68e", "https://preview.trycloudflare.com"))
      .toBe("https://preview.trycloudflare.com/ar/100010-9ce68e");
    expect(productArShareUrl("https://www.svetpovoljnihcena.rs/p/100010-9ce68e", "https://preview.trycloudflare.com"))
      .toBe("https://www.svetpovoljnihcena.rs/ar/100010-9ce68e");
  });
  it("builds Android AR-only links with a manual fallback on the reachable origin", () => {
    const intent = androidArIntent(getProductArAsset("100010-9ce68e")!, "https://preview.trycloudflare.com/ar/100010-9ce68e");
    expect(intent).toContain("mode=ar_only");
    expect(intent).toContain("package=com.google.ar.core;");
    expect(intent).not.toContain("googlequicksearchbox");
    expect(intent).toContain("resizable=false");
    expect(intent).toContain(encodeURIComponent(getProductArAsset("100010-9ce68e")!.glbUrl));
    expect(intent).not.toContain("preview.trycloudflare.com%2Fmodels");
    expect(intent).toContain(encodeURIComponent("https://preview.trycloudflare.com/ar/100010-9ce68e?manual=1&arFallback=1"));
  });
  it("opens the AR entry in Chrome without automatically relaunching another intent", () => {
    const intent = androidChromeArIntent("https://www.svetpovoljnihcena.rs/ar/100010-9ce68e?arFallback=1#viewer");
    expect(intent).toContain("intent://www.svetpovoljnihcena.rs/ar/100010-9ce68e?manual=1#Intent;");
    expect(intent).toContain("package=com.android.chrome;");
    expect(intent).toContain(encodeURIComponent("https://www.svetpovoljnihcena.rs/ar/100010-9ce68e?manual=1"));
  });
  it("distinguishes desktop, Android, and iPad desktop-mode Safari", () => {
    expect(arPlatform("Mozilla Macintosh", 0)).toBe("desktop");
    expect(arPlatform("Mozilla Macintosh", 5)).toBe("ios");
    expect(arPlatform("Mozilla iPhone")).toBe("ios");
    expect(arPlatform("Mozilla Android")).toBe("android");
  });
});
