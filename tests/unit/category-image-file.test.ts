import { describe, expect, it } from "vitest";
import {
  CATEGORY_IMAGE_MAX_BYTES,
  getCategoryStagingImageKey,
  getManagedCategoryImageKey,
  toCategoryImageUploadBody,
  validateCategoryImageFile,
} from "../../src/lib/categories/image-file";

describe("category image files", () => {
  it("accepts supported raster images with matching extensions", () => {
    expect(
      validateCategoryImageFile({
        name: "namestaj.jpg",
        size: 1024,
        type: "image/jpeg",
      }),
    ).toBe("jpg");
    expect(
      validateCategoryImageFile({
        name: "bela-tehnika.webp",
        size: 1024,
        type: "image/webp",
      }),
    ).toBe("webp");
  });

  it("rejects oversized, unsupported and mismatched files", () => {
    expect(() =>
      validateCategoryImageFile({
        name: "large.png",
        size: CATEGORY_IMAGE_MAX_BYTES + 1,
        type: "image/png",
      }),
    ).toThrow("8 MB");
    expect(() =>
      validateCategoryImageFile({
        name: "category.svg",
        size: 1024,
        type: "image/svg+xml",
      }),
    ).toThrow("PNG, JPG, WebP i AVIF");
    expect(() =>
      validateCategoryImageFile({
        name: "category.png",
        size: 1024,
        type: "image/jpeg",
      }),
    ).toThrow("Ekstenzija");
  });

  it("recognizes only finalized category media as managed", () => {
    expect(
      getManagedCategoryImageKey(
        "content/categories/1785782472770-2fb2e83543469098.webp",
      ),
    ).toBe("content/categories/1785782472770-2fb2e83543469098.webp");
    expect(
      getManagedCategoryImageKey(
        "content/categories/staging/admin-123/1785782472770-2fb2e83543469098.jpg",
      ),
    ).toBeNull();
    expect(
      getManagedCategoryImageKey("content/banners/hero/banner.webp"),
    ).toBeNull();
  });

  it("accepts staging keys only for the expected admin", () => {
    const key =
      "content/categories/staging/admin-123/1785782472770-2fb2e83543469098.jpg";

    expect(getCategoryStagingImageKey(key, { actorId: "admin-123" })).toBe(
      key,
    );
    expect(
      getCategoryStagingImageKey(key, { actorId: "another-admin" }),
    ).toBeNull();
    expect(
      getCategoryStagingImageKey(
        "content/categories/staging/admin-123/../x.jpg",
        { actorId: "admin-123" },
      ),
    ).toBeNull();
  });

  it("copies binary upload bytes without extra buffer data", () => {
    const backing = new Uint8Array([9, 0x52, 0x80, 0xff, 0x00, 0x49, 8]);
    const source = backing.subarray(1, 6);

    expect(
      Array.from(new Uint8Array(toCategoryImageUploadBody(source))),
    ).toEqual([0x52, 0x80, 0xff, 0x00, 0x49]);
  });
});
