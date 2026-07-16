import { describe, expect, it } from "vitest";
import { getCatalogReadiness } from "@/lib/catalog-readiness";

const readyProduct = {
  fullPrice: 12_000,
  salePrice: null,
  dimensionsCm: { w: 100, d: 50, h: 70 },
  media: { images: ["/product.jpg"] },
  deliveryDays: { min: 3, max: 5 },
};

describe("catalog readiness", () => {
  it("accepts a complete product", () => {
    expect(getCatalogReadiness(readyProduct)).toEqual({ ready: true, reasons: [] });
  });

  it("reports every unsafe catalog condition", () => {
    expect(
      getCatalogReadiness({
        ...readyProduct,
        salePrice: 0,
        dimensionsCm: { w: 0, d: 50, h: 70 },
        media: { images: [] },
        deliveryDays: { min: 7, max: 3 },
      }),
    ).toEqual({
      ready: false,
      reasons: [
        "invalid_price",
        "missing_dimensions",
        "missing_media",
        "invalid_delivery_window",
      ],
    });
  });
});
