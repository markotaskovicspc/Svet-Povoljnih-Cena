import { describe, expect, it } from "vitest";
import {
  getManagedPictogramIconKey,
  PICTOGRAM_ICON_MAX_BYTES,
  validatePictogramIconFile,
} from "../../src/lib/pictograms/icon-file";

describe("pictogram icon files", () => {
  it("accepts supported image formats with matching extensions", () => {
    expect(validatePictogramIconFile({ name: "delivery.png", size: 1024, type: "image/png" })).toBe("png");
    expect(validatePictogramIconFile({ name: "quality.webp", size: 1024, type: "image/webp" })).toBe("webp");
    expect(validatePictogramIconFile({ name: "sale.jpeg", size: 1024, type: "image/jpeg" })).toBe("jpeg");
  });

  it("rejects oversized and unsupported files", () => {
    expect(() =>
      validatePictogramIconFile({
        name: "large.png",
        size: PICTOGRAM_ICON_MAX_BYTES + 1,
        type: "image/png",
      }),
    ).toThrow("750 KB");
    expect(() =>
      validatePictogramIconFile({ name: "icon.svg", size: 1024, type: "image/svg+xml" }),
    ).toThrow("PNG, JPG i WebP");
  });

  it("only treats the pictograms prefix as managed pictogram storage", () => {
    expect(getManagedPictogramIconKey("pictograms/delivery.png")).toBe("pictograms/delivery.png");
    expect(getManagedPictogramIconKey("products/product/photo.png")).toBeNull();
  });
});
