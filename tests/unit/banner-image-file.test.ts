import { describe, expect, it } from "vitest";
import {
  BANNER_IMAGE_MAX_BYTES,
  getBannerStagingImageKey,
  getManagedBannerImageKey,
  mergeBannerUploadFiles,
  shouldContinuePendingBannerSvg,
  splitBannerUploadFiles,
  toBannerImageUploadBody,
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
    expect(
      validateBannerImageFile({
        name: "hero.svg",
        size: 1024,
        type: "image/svg+xml",
      }),
    ).toBe("svg");
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
        name: "banner.gif",
        size: 1024,
        type: "image/gif",
      }),
    ).toThrow("PNG, JPG, WebP, AVIF i SVG");
    expect(() =>
      validateBannerImageFile({
        name: "banner.png",
        size: 1024,
        type: "image/jpeg",
      }),
    ).toThrow("Ekstenzija");
  });

  it("supports one normal image or one SVG with companion images in any order", () => {
    const svg = { name: "hero.svg", size: 100, type: "image/svg+xml" };
    const png = { name: "logo.png", size: 100, type: "image/png" };
    const jpg = { name: "photo.jpg", size: 100, type: "image/jpeg" };

    expect(splitBannerUploadFiles([png])).toEqual({
      primary: png,
      companions: [],
    });
    expect(splitBannerUploadFiles([png, svg, jpg])).toEqual({
      primary: svg,
      companions: [png, jpg],
    });
  });

  it("rejects ambiguous multi-image banner selections", () => {
    const png = { name: "a.png", size: 100, type: "image/png" };
    const jpg = { name: "b.jpg", size: 100, type: "image/jpeg" };
    const firstSvg = { name: "a.svg", size: 100, type: "image/svg+xml" };
    const secondSvg = { name: "b.svg", size: 100, type: "image/svg+xml" };

    expect(() => splitBannerUploadFiles([png, jpg])).toThrow("samo jednu");
    expect(() => splitBannerUploadFiles([firstSvg, secondSvg])).toThrow(
      "samo jedan SVG",
    );
  });

  it("continues a pending SVG when a missing companion is selected later", () => {
    const svg = { name: "hero.svg", size: 100, type: "image/svg+xml" };
    const png = { name: "Logo.PNG", size: 100, type: "image/png" };
    const replacement = { name: "new.jpg", size: 100, type: "image/jpeg" };

    expect(shouldContinuePendingBannerSvg([png], ["logo.png"])).toBe(true);
    expect(shouldContinuePendingBannerSvg([replacement], ["logo.png"])).toBe(
      false,
    );
    expect(shouldContinuePendingBannerSvg([svg], ["logo.png"])).toBe(false);
  });

  it("merges repeated sequential selections by normalized file name", () => {
    const first = { name: "logo.png" };
    const replacement = { name: "LOGO.PNG" };
    const svg = { name: "hero.svg" };

    expect(mergeBannerUploadFiles([svg, first], [replacement])).toEqual([
      svg,
      replacement,
    ]);
  });

  it("only treats the dedicated banner prefix as managed banner storage", () => {
    expect(getManagedBannerImageKey("content/banners/hero/banner.webp")).toBe(
      "content/banners/hero/banner.webp",
    );
    expect(getManagedBannerImageKey("products/product/photo.webp")).toBeNull();
    expect(
      getManagedBannerImageKey("https://images.unsplash.com/a.jpg"),
    ).toBeNull();
  });

  it("accepts staging keys only for the expected admin, placement and variant", () => {
    const key =
      "content/banners/staging/hero/admin-123/1785782472770-2fb2e83543469098-desktop.jpg";

    expect(
      getBannerStagingImageKey(key, {
        actorId: "admin-123",
        placement: "HERO",
        variant: "desktop",
      }),
    ).toBe(key);
    expect(
      getBannerStagingImageKey(key, {
        actorId: "another-admin",
        placement: "HERO",
        variant: "desktop",
      }),
    ).toBeNull();
    expect(
      getBannerStagingImageKey(key, {
        actorId: "admin-123",
        placement: "HERO",
        variant: "mobile",
      }),
    ).toBeNull();
    expect(
      getBannerStagingImageKey(
        "content/banners/staging/hero/admin-123/../x.jpg",
        {
          actorId: "admin-123",
          placement: "HERO",
          variant: "desktop",
        },
      ),
    ).toBeNull();
  });

  it("copies binary upload bytes without UTF-8 conversion or extra buffer data", () => {
    const backing = new Uint8Array([9, 0x52, 0x80, 0xff, 0x00, 0x49, 8]);
    const source = backing.subarray(1, 6);

    expect(Array.from(new Uint8Array(toBannerImageUploadBody(source)))).toEqual(
      [0x52, 0x80, 0xff, 0x00, 0x49],
    );
  });
});
