import { describe, expect, it } from "vitest";
import {
  calculatePublishedDeliveryTariff,
  calculatePublishedDeliveryTariffQuote,
  deliveryCategory,
  deliveryRate,
  packageVolumetricDimension,
} from "@/lib/delivery-tariff";
import { formatProductCardDimensions } from "@/lib/product-dimensions";
import {
  goodsReceiptCountryOriginFallbacks,
  goodsReceiptMasterIssues,
  goodsReceiptMasterWarnings,
} from "@/lib/admin/goods-receipt-readiness";
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
      unitPackWidthCm: 50,
      unitPackDepthCm: 40,
      unitPackHeightCm: 30,
      packGrossWeightKg: 4,
    };
    const guestTariff = calculatePublishedDeliveryTariff([product], {
      loggedIn: false,
    });
    expect(guestTariff?.total).toBe(399);
    expect(guestTariff?.categories[1]).toEqual({
      weightKg: 8,
      subtotal: 2_200,
      price: 399,
    });
    expect(calculatePublishedDeliveryTariff([product], { loggedIn: true })?.total).toBe(0);
  });

  it("uses the published category-II rates without the retired surcharge", () => {
    expect(calculatePublishedDeliveryTariff([{
      qty: 1,
      unitPrice: 5_000,
      unitPackWidthCm: 101,
      unitPackDepthCm: 60,
      unitPackHeightCm: 40,
      packGrossWeightKg: 4,
    }], { loggedIn: false })?.total).toBe(699);
  });

  it("keeps the published weight boundaries inclusive at their upper limit", () => {
    expect(deliveryRate(1, 5)).toBe(299);
    expect(deliveryRate(1, 5.001)).toBe(399);
    expect(deliveryRate(2, 50)).toBe(1_399);
    expect(deliveryRate(2, 50.001)).toBeNull();
  });

  it("grants free category-I delivery only above the 2,000 RSD threshold", () => {
    const product = {
      qty: 1,
      unitPrice: 2_000,
      unitPackWidthCm: 50,
      unitPackDepthCm: 40,
      unitPackHeightCm: 30,
      grossWeightKg: 2,
    };

    expect(calculatePublishedDeliveryTariff([product], { loggedIn: true })?.total).toBe(299);
    expect(
      calculatePublishedDeliveryTariff(
        [{ ...product, unitPrice: 2_000.01 }],
        { loggedIn: true },
      )?.total,
    ).toBe(0);
  });

  it("returns no invented tariff above the published 50 kg ceiling", () => {
    expect(calculatePublishedDeliveryTariff([{
      qty: 1,
      unitPrice: 5_000,
      unitPackWidthCm: 70,
      unitPackDepthCm: 40,
      unitPackHeightCm: 30,
      packGrossWeightKg: 51,
    }], { loggedIn: true })).toBeNull();
  });

  it("keeps the overweight category visible without inventing a fallback price", () => {
    const quote = calculatePublishedDeliveryTariffQuote(
      [
        {
          qty: 1,
          unitPrice: 10_000,
          unitPackWidthCm: 180,
          unitPackDepthCm: 100,
          unitPackHeightCm: 20,
          grossWeightKg: 51,
        },
      ],
      { loggedIn: true },
    );

    expect(quote).toMatchObject({
      total: null,
      issue: "WEIGHT_ABOVE_50_KG",
      categories: {
        2: { weightKg: 51, subtotal: 10_000, price: null },
      },
    });
  });

  it("classifies by the individual article package and sums each category separately", () => {
    const tariff = calculatePublishedDeliveryTariff(
      [
        {
          qty: 1,
          unitPrice: 1_500,
          unitPackWidthCm: 50,
          unitPackDepthCm: 40,
          unitPackHeightCm: 30,
          packWidthCm: 200,
          packDepthCm: 100,
          packHeightCm: 80,
          packGrossWeightKg: 4,
        },
        {
          qty: 1,
          unitPrice: 4_000,
          unitPackWidthCm: 101,
          unitPackDepthCm: 60,
          unitPackHeightCm: 40,
          packGrossWeightKg: 6,
        },
      ],
      { loggedIn: true },
    );

    expect(tariff).toMatchObject({
      total: 1_098,
      categoryOnePrice: 299,
      categoryTwoPrice: 799,
      categories: {
        1: { weightKg: 4, subtotal: 1_500, price: 299 },
        2: { weightKg: 6, subtotal: 4_000, price: 799 },
      },
    });
  });

  it("uses one article's gross weight instead of charging the whole transport carton", () => {
    const tariff = calculatePublishedDeliveryTariff(
      [
        {
          qty: 1,
          unitPrice: 5_000,
          unitPackWidthCm: 50,
          unitPackDepthCm: 40,
          unitPackHeightCm: 30,
          grossWeightKg: 2,
          packQty: 10,
          packGrossWeightKg: 23,
        },
      ],
      { loggedIn: false },
    );

    expect(tariff?.categories[1].weightKg).toBe(2);
    expect(tariff?.total).toBe(299);
  });

  it("derives an individual weight from the transport carton when unit weight is absent", () => {
    const tariff = calculatePublishedDeliveryTariff(
      [
        {
          qty: 2,
          unitPrice: 500,
          unitPackWidthCm: 50,
          unitPackDepthCm: 40,
          unitPackHeightCm: 30,
          packQty: 30,
          packGrossWeightKg: 30,
        },
      ],
      { loggedIn: false },
    );

    expect(tariff?.categories[1].weightKg).toBe(2);
    expect(tariff?.total).toBe(299);
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

  it("lists operational master fields that require follow-up after receipt", () => {
    const issues = goodsReceiptMasterIssues({
      id: "product-1",
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
      id: "product-1",
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

  it("uses the supplier country for legacy articles without a stored origin", () => {
    const lines = [
      {
        qty: 10,
        sku: "100001",
        product: {
          id: "product-1",
          sku: "100001",
          name: "Artikal",
          description: "Opis",
          supplierId: "supplier-1",
          supplier: { country: "CN" },
          countryOfOrigin: null,
          hsCode: null,
          widthCm: 10,
          depthCm: 20,
          heightCm: 30,
          grossWeightKg: 2,
          packQty: 1,
          packWidthCm: 10,
          packDepthCm: 20,
          packHeightCm: 30,
          packGrossWeightKg: 2,
          containerQty: null,
          containerGrossWeightKg: null,
          categories: [{}],
          priceListEntries: [{}],
        },
      },
    ];
    const [warning] = goodsReceiptMasterWarnings(lines);

    expect(warning).toEqual({
      productId: "product-1",
      sku: "100001",
      issues: ["tarifni broj"],
    });
    expect(goodsReceiptCountryOriginFallbacks(lines)).toEqual([
      {
        productId: "product-1",
        sku: "100001",
        country: "CN",
        previousCountryOfOrigin: null,
      },
    ]);
  });
});
