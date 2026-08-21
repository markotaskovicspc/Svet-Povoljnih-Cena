import { describe, expect, it } from "vitest";
import { resolveDeliveryMethodQuote } from "@/lib/checkout/config-shared";

describe("delivery method quote", () => {
  it("uses the published courier tariff when the cart is within 50 kg", () => {
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
      prices: { kurir: 1_098, kamion: 4_990 },
      recommendedMethod: "kurir",
      pricingIssue: null,
    });
  });

  it("uses the documented 4,990 RSD truck fallback above 50 kg", () => {
    expect(
      resolveDeliveryMethodQuote({
        publishedTariff: {
          total: null,
          categoryOnePrice: 399,
          categoryTwoPrice: null,
          categories: {
            1: { weightKg: 7.6, subtotal: 4_722, price: 399 },
            2: { weightKg: 82, subtotal: 36_997, price: null },
          },
          issue: "WEIGHT_ABOVE_50_KG",
        },
        configuredCourierPrice: null,
        configuredTruckPrice: null,
        truckAvailable: true,
      }),
    ).toEqual({
      prices: { kurir: null, kamion: 4_990 },
      recommendedMethod: "kamion",
      pricingIssue: null,
      deliveryCategoryBreakdown: null,
    });
  });

  it("uses an explicit admin truck price before the fixed fallback", () => {
    expect(
      resolveDeliveryMethodQuote({
        publishedTariff: {
          total: null,
          categoryOnePrice: null,
          categoryTwoPrice: null,
          categories: null,
          issue: "WEIGHT_ABOVE_50_KG",
        },
        configuredCourierPrice: null,
        configuredTruckPrice: 5_490,
        truckAvailable: true,
      }).prices.kamion,
    ).toBe(5_490);
  });

  it("blocks an overweight cart when truck delivery is unavailable for the city", () => {
    expect(
      resolveDeliveryMethodQuote({
        publishedTariff: {
          total: null,
          categoryOnePrice: null,
          categoryTwoPrice: null,
          categories: null,
          issue: "WEIGHT_ABOVE_50_KG",
        },
        configuredCourierPrice: null,
        configuredTruckPrice: null,
        truckAvailable: false,
      }),
    ).toMatchObject({
      prices: { kurir: null, kamion: null },
      recommendedMethod: null,
      pricingIssue: "TRUCK_UNAVAILABLE_FOR_CITY",
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
      prices: { kurir: 990, kamion: 4_990 },
      recommendedMethod: "kurir",
      pricingIssue: null,
    });
  });
});
