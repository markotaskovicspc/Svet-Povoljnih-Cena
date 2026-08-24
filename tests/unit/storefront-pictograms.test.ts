import { describe, expect, it } from "vitest";
import {
  EXPRESS_DELIVERY_48H_PICTOGRAM,
  resolveStorefrontPictograms,
  WARRANTY_2_PLUS_1_PICTOGRAM,
} from "@/lib/storefront-pictograms";
import type { Pictogram } from "@/types";

const configuredWarranty: Pictogram = {
  id: "configured-warranty",
  code: "3",
  label: "2+1",
  iconUrl: "https://cdn.example.test/warranty.png",
};
const configuredDelivery: Pictogram = {
  id: "configured-delivery",
  code: "48h",
  label: "48h",
  iconUrl: "https://cdn.example.test/delivery.png",
};
const productFeature: Pictogram = {
  id: "configured-feature",
  code: "feature",
  label: "Posebna karakteristika",
  iconUrl: "https://cdn.example.test/feature.png",
};

describe("storefront pictogram placement", () => {
  it("places 2+1 last in the top-left feature stack for every non-Rabalux product", () => {
    const resolved = resolveStorefrontPictograms({
      pictograms: [productFeature],
      supplierIntegrationKey: null,
    });

    expect(resolved.featurePictograms).toEqual([
      productFeature,
      WARRANTY_2_PLUS_1_PICTOGRAM,
    ]);
    expect(resolved.cornerPictograms).toEqual([
      EXPRESS_DELIVERY_48H_PICTOGRAM,
    ]);
  });

  it("does not add 2+1 to Rabalux products", () => {
    const resolved = resolveStorefrontPictograms({
      pictograms: [configuredWarranty, productFeature],
      supplierIntegrationKey: " rabalux ",
    });

    expect(resolved.featurePictograms).toEqual([productFeature]);
    expect(resolved.cornerPictograms).toEqual([
      EXPRESS_DELIVERY_48H_PICTOGRAM,
    ]);
  });

  it("reuses admin-configured global pictograms without duplicating them", () => {
    const resolved = resolveStorefrontPictograms({
      pictograms: [configuredDelivery, productFeature, configuredWarranty],
      supplierIntegrationKey: "OTHER",
    });

    expect(resolved.featurePictograms).toEqual([
      productFeature,
      configuredWarranty,
    ]);
    expect(resolved.cornerPictograms).toEqual([
      configuredDelivery,
    ]);
    expect(
      resolved.featurePictograms.filter((pictogram) => pictogram.code === "3"),
    ).toHaveLength(1);
    expect(
      resolved.cornerPictograms.filter((pictogram) => pictogram.code === "48h"),
    ).toHaveLength(1);
  });
});
