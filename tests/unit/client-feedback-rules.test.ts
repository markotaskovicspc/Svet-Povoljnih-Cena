import { describe, expect, it } from "vitest";
import {
  calculatePublishedDeliveryTariff,
  deliveryCategory,
  packageVolumetricDimension,
} from "@/lib/delivery-tariff";
import { formatProductCardDimensions } from "@/lib/product-dimensions";
import { goodsReceiptMasterIssues } from "@/lib/admin/goods-receipt-readiness";
import { lowestPublicPriceLast30Days } from "@/lib/pricing/retail-price";

describe("confirmed client rules", () => {
  it("hides absent/sentinel card dimensions and omits the label", () => {
    expect(formatProductCardDimensions({ w: 0, d: 20, h: 30 })).toBe("");
    expect(formatProductCardDimensions({ w: 1, d: 1, h: 1 })).toBe("");
    expect(formatProductCardDimensions({ w: 60, d: 40, h: 30 })).toBe(
      "60 × 40 × 30 cm",
    );
  });

  it("calculates the published category, volumetric measure and logged-in free tier", () => {
    expect(deliveryCategory([60, 40, 30])).toBe(1);
    expect(deliveryCategory([101, 60, 40])).toBe(2);
    expect(packageVolumetricDimension([100, 60, 40])).toBe(300);
    expect(deliveryCategory([100, 60, 40])).toBeNull();
    const product = {
      qty: 2,
      unitPrice: 1_100,
      packQty: 1,
      packWidthCm: 50,
      packDepthCm: 40,
      packHeightCm: 30,
      packGrossWeightKg: 4,
    };
    expect(calculatePublishedDeliveryTariff([product], { loggedIn: false })?.total).toBe(399);
    expect(calculatePublishedDeliveryTariff([product], { loggedIn: true })?.total).toBe(0);
  });

  it("uses the published category-II rates without the retired surcharge", () => {
    expect(calculatePublishedDeliveryTariff([{
      qty: 1,
      unitPrice: 5_000,
      packWidthCm: 101,
      packDepthCm: 60,
      packHeightCm: 40,
      packGrossWeightKg: 4,
    }], { loggedIn: false })?.total).toBe(699);
  });

  it("returns no invented tariff above the published 50 kg ceiling", () => {
    expect(calculatePublishedDeliveryTariff([{
      qty: 1,
      unitPrice: 5_000,
      packWidthCm: 70,
      packDepthCm: 40,
      packHeightCm: 30,
      packGrossWeightKg: 51,
    }], { loggedIn: true })).toBeNull();
  });

  it("finds the lowest non-loyalty public price before the active offer", () => {
    const reference = lowestPublicPriceLast30Days(
      [{
        price: 9_500,
        validFrom: new Date("2026-06-20"),
        validTo: null,
        priceList: {
          id: "mp",
          name: "MP",
          code: "MP",
          active: true,
          validFrom: null,
          validTo: null,
        },
      }],
      [
        {
          salePrice: 9_000,
          action: {
            startsAt: new Date("2026-06-25"),
            endsAt: new Date("2026-06-30"),
            priority: 1,
          },
        },
        {
          salePrice: 8_000,
          action: {
            startsAt: new Date("2026-07-10"),
            endsAt: new Date("2026-07-31"),
            priority: 10,
          },
        },
      ],
      10_000,
      new Date("2026-07-18"),
    );
    expect(reference).toBe(9_000);
  });

  it("lists operational master fields that block a goods receipt", () => {
    const issues = goodsReceiptMasterIssues({
      sku: "100001",
      name: "Artikal",
      description: "Opis",
      supplierId: null,
      countryOfOrigin: null,
      hsCode: null,
      widthCm: 10,
      depthCm: 20,
      heightCm: 30,
      grossWeightKg: 2,
      packQty: null,
      packWidthCm: null,
      packDepthCm: null,
      packHeightCm: null,
      packGrossWeightKg: null,
      containerQty: null,
      containerGrossWeightKg: null,
      categories: [],
      priceListEntries: [],
    });
    expect(issues).toEqual(expect.arrayContaining([
      "dobavljač",
      "kategorija",
      "količina kontejnera ili transportne dimenzije paketa",
      "aktivna maloprodajna cena",
    ]));
  });

  it("prihvata količinu za ceo kontejner kao alternativu transportnom pakovanju", () => {
    const issues = goodsReceiptMasterIssues({
      sku: "100001",
      name: "Artikal",
      description: "Opis",
      supplierId: "supplier-1",
      countryOfOrigin: "CN",
      hsCode: "9401",
      widthCm: 10,
      depthCm: 20,
      heightCm: 30,
      grossWeightKg: 2,
      packQty: 1,
      packWidthCm: 1,
      packDepthCm: 1,
      packHeightCm: 1,
      packGrossWeightKg: 0,
      containerQty: 1_900,
      containerGrossWeightKg: null,
      categories: [{}],
      priceListEntries: [{}],
    });
    expect(issues).not.toContain("količina kontejnera ili transportne dimenzije paketa");
    expect(issues).not.toContain("bruto težina paketa");
  });
});
