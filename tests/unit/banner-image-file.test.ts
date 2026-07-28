import { describe, expect, it } from "vitest";
import {
  BANNER_IMAGE_MAX_BYTES,
  getManagedBannerImageKey,
  validateBannerImageFile,
} from "../../src/lib/banners/image-file";

describe("banner image files", () => {
  it("accepts supported raster images with matching extensions", () => {
    expect(
      validateBannerImageFile({
        name: "hero.jpg",
        size: 1024,
        type: "image/jpeg",
      }),
    ).toBe("jpg");
    expect(
      validateBannerImageFile({
        name: "hero-mobile.webp",
        size: 1024,
        type: "image/webp",
      }),
    ).toBe("webp");
    expect(
      validateBannerImageFile({
        name: "wide.avif",
        size: 1024,
        type: "image/avif",
      }),
    ).toBe("avif");
  });

  it("rejects oversized, unsupported and mismatched files", () => {
    expect(() =>
      validateBannerImageFile({
        name: "large.png",
        size: BANNER_IMAGE_MAX_BYTES + 1,
        type: "image/png",
      }),
    ).toThrow("8 MB");
    expect(() =>
      validateBannerImageFile({
        name: "banner.svg",
        size: 1024,
        type: "image/svg+xml",
      }),
    ).toThrow("PNG, JPG, WebP i AVIF");
    expect(() =>
      validateBannerImageFile({
        name: "banner.png",
        size: 1024,
        type: "image/jpeg",
      }),
    ).toThrow("Ekstenzija");
  });

  it("only treats the dedicated banner prefix as managed banner storage", () => {
    expect(
      getManagedBannerImageKey("content/banners/hero/banner.webp"),
    ).toBe("content/banners/hero/banner.webp");
    expect(getManagedBannerImageKey("products/product/photo.webp")).toBeNull();
    expect(getManagedBannerImageKey("https://images.unsplash.com/a.jpg")).toBeNull();
  });
});
