import { describe, expect, it } from "vitest";
import { getProductAvailability } from "@/lib/product-availability";
import { hasStorefrontIncomingStock } from "@/lib/storefront-incoming";

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
      label: "Dostupno",
      isSupplierSourced: true,
    });
    expect(result.message).toBe(
      "Isporuka 7–10 radnih dana",
    );
    expect(result.message).not.toContain("10 na stanju");
  });

  it("uses the supplier label and delivery window for Rabalux stock", () => {
    const result = getProductAvailability({
      ...readyProduct,
      supplierIntegrationKey: "RABALUX",
      availabilitySource: "SUPPLIER",
      deliveryDays: { min: 1, max: 2 },
    });
    expect(result).toMatchObject({
      canAddToCart: true,
      label: "Dostupno kod dobavljača",
      message: "Dostupno kod dobavljača · Isporuka 1–2 radnih dana",
    });
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

  it("shows incoming information only for non-Rabalux goods", () => {
    const own = getProductAvailability({
      ...readyProduct,
      stock: 0,
      incomingStock: 5,
      availabilitySource: "NONE",
      supplierIntegrationKey: "SPC",
    });
    const rabalux = getProductAvailability({
      ...readyProduct,
      stock: 0,
      incomingStock: 5,
      availabilitySource: "NONE",
      supplierIntegrationKey: "RABALUX",
    });

    expect(own.label).toBe("U dolasku");
    expect(rabalux.label).toBe("Nije dostupno");
  });

  it("keeps the non-Rabalux rule consistent for every storefront surface", () => {
    expect(
      hasStorefrontIncomingStock({
        incomingStock: 5,
        supplierIntegrationKey: "SPC",
      }),
    ).toBe(true);
    expect(
      hasStorefrontIncomingStock({
        incomingStock: 5,
        supplierIntegrationKey: " rabalux ",
      }),
    ).toBe(false);
  });
});
