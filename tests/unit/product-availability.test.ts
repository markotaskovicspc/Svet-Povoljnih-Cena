import { describe, expect, it } from "vitest";
import { getProductAvailability } from "@/lib/product-availability";

const readyProduct = {
  stock: 10,
  incomingStock: 0,
  fullPrice: 1_000,
  dimensionsCm: { w: 10, d: 10, h: 10 },
  packageDimensionsCm: undefined,
  media: { images: [{ url: "/test.jpg" }] },
  deliveryDays: { min: 7, max: 10 },
  supplierNextArrivalAt: undefined,
};

describe("product availability messaging", () => {
  it("labels supplier-sourced stock without exposing the exact quantity", () => {
    const result = getProductAvailability({
      ...readyProduct,
      availabilitySource: "SUPPLIER",
    });
    expect(result).toMatchObject({
      canAddToCart: true,
      label: "Dostupno kod dobavljača",
      isSupplierSourced: true,
    });
    expect(result.message).toBe(
      "Dostupno kod dobavljača · isporuka 7–10 radnih dana",
    );
    expect(result.message).not.toContain("10 na stanju");
  });

  it("keeps exact low-stock messaging for DC stock", () => {
    expect(
      getProductAvailability({
        ...readyProduct,
        stock: 2,
        availabilitySource: "DC",
      }).message,
    ).toBe("Još 2 na stanju");
  });
});
