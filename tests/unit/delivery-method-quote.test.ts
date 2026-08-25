import { describe, expect, it } from "vitest";
import { resolveDeliveryMethodQuote } from "@/lib/checkout/config-shared";

describe("delivery method quote", () => {
  it("uses the published courier tariff", () => {
    expect(
      resolveDeliveryMethodQuote({
        publishedTariff: {
          total: 1_098,
          categoryOnePrice: 299,
          categoryTwoPrice: 799,
          categories: {
            1: { weightKg: 4, subtotal: 1_500, price: 299 },
            2: { weightKg: 6, subtotal: 4_000, price: 799 },
          },
          issue: null,
        },
        configuredCourierPrice: null,
        configuredTruckPrice: null,
        truckAvailable: true,
      }),
    ).toMatchObject({
      prices: { kurir: 1_098, kamion: null },
      recommendedMethod: "kurir",
      pricingIssue: null,
    });
  });

  it("uses the extended courier tariff above the old 50 kg ceiling", () => {
    expect(
      resolveDeliveryMethodQuote({
        publishedTariff: {
          total: 2_298,
          categoryOnePrice: 399,
          categoryTwoPrice: 1_899,
          categories: {
            1: { weightKg: 7.6, subtotal: 4_722, price: 399 },
            2: { weightKg: 82, subtotal: 36_997, price: 1_899 },
          },
          issue: null,
        },
        configuredCourierPrice: null,
        configuredTruckPrice: null,
        truckAvailable: true,
      }),
    ).toMatchObject({
      prices: { kurir: 2_298, kamion: null },
      recommendedMethod: "kurir",
      pricingIssue: null,
    });
  });

  it("keeps truck delivery disabled even when an old admin price exists", () => {
    expect(
      resolveDeliveryMethodQuote({
        publishedTariff: null,
        configuredCourierPrice: 990,
        configuredTruckPrice: 5_490,
        truckAvailable: true,
      }).prices.kamion,
    ).toBeNull();
  });

  it("keeps an incomplete custom-tariff issue while truck delivery is disabled", () => {
    expect(
      resolveDeliveryMethodQuote({
        publishedTariff: {
          total: null,
          categoryOnePrice: null,
          categoryTwoPrice: null,
          categories: null,
          issue: "WEIGHT_OUTSIDE_TARIFF",
        },
        configuredCourierPrice: null,
        configuredTruckPrice: null,
        truckAvailable: false,
      }),
    ).toMatchObject({
      prices: { kurir: null, kamion: null },
      recommendedMethod: null,
      pricingIssue: "WEIGHT_OUTSIDE_TARIFF",
    });
  });

  it("uses the documented 990 RSD courier fallback when package data is missing", () => {
    expect(
      resolveDeliveryMethodQuote({
        publishedTariff: {
          total: null,
          categoryOnePrice: null,
          categoryTwoPrice: null,
          categories: null,
          issue: "MISSING_WEIGHT",
        },
        configuredCourierPrice: null,
        configuredTruckPrice: null,
        truckAvailable: true,
      }),
    ).toMatchObject({
      prices: { kurir: 990, kamion: null },
      recommendedMethod: "kurir",
      pricingIssue: null,
    });
  });
});
