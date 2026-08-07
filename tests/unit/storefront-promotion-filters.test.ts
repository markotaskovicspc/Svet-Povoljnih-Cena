import { describe, expect, it } from "vitest";
import {
  excludeRabaluxPromotionProductsWhere,
  heroProductsWhere,
  limitedOfferProductsWhere,
  permanentPriceProductsWhere,
  storefrontMonth,
} from "@/lib/storefront/promotion-filters";

describe("storefront promotion filters", () => {
  it("uses the Belgrade calendar month at the UTC month boundary", () => {
    expect(storefrontMonth(new Date("2026-07-31T22:30:00.000Z"))).toEqual({
      year: 2026,
      month: 8,
    });
  });

  it("includes ERP monthly heroes alongside product and action flags", () => {
    const now = new Date("2026-07-30T10:00:00.000Z");

    expect(heroProductsWhere(now, ["SKU-2", "SKU-1"])).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { isHero: true },
          { sku: { in: ["SKU-2", "SKU-1"] } },
          expect.objectContaining({
            action: {
              is: expect.objectContaining({
                kind: "HEROJI",
              }),
            },
          }),
          expect.objectContaining({
            actionPrices: {
              some: {
                action: {
                  is: expect.objectContaining({
                    kind: "HEROJI",
                  }),
                },
              },
            },
          }),
        ]),
      }),
    );
  });

  it("treats both limited and ERP DTZ articles as 'Dok traju zalihe'", () => {
    expect(limitedOfferProductsWhere()).toEqual({
      OR: [{ isLimited: true }, { isDtz: true }],
    });
  });

  it("provides an explicit Rabalux exclusion for Novo and DTZ queries", () => {
    expect(excludeRabaluxPromotionProductsWhere()).toEqual({
      OR: [
        { supplier: { is: null } },
        { supplier: { is: { integrationKey: null } } },
        {
          supplier: {
            is: { integrationKey: { not: "RABALUX" } },
          },
        },
      ],
    });
  });

  it("selects permanent-price products by the action flag, not its slug", () => {
    expect(permanentPriceProductsWhere()).toEqual({
      OR: [
        { action: { is: { isPermanent: true } } },
        {
          actionPrices: {
            some: { action: { is: { isPermanent: true } } },
          },
        },
      ],
    });
  });
});
