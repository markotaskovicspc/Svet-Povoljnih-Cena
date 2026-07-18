import { describe, expect, it } from "vitest";
import { resolvePromotionPrice } from "@/lib/pricing";

const now = new Date("2026-07-18T12:00:00.000Z");

describe("ERP pricing precedence", () => {
  it("uses the highest-priority live product action exclusively", () => {
    const price = resolvePromotionPrice(
      {
        fullPrice: 10_000,
        loyaltyPrice: 8_500,
        actionPrices: [
          {
            price: 8_000,
            priority: 2,
            startsAt: "2026-07-01",
            endsAt: "2026-07-31",
          },
          {
            price: 7_500,
            priority: 9,
            startsAt: "2026-07-01",
            endsAt: "2026-07-31",
          },
        ],
        linearPromotions: [
          {
            discountPct: 20,
            priority: 99,
            startsAt: "2026-07-01",
            endsAt: "2026-07-31",
          },
        ],
      },
      { now, loggedIn: true },
    );
    expect(price.effective).toBe(7_500);
    expect(price.kind).toBe("sale");
  });

  it("stacks authenticated loyalty then one highest-priority linear discount under the cap", () => {
    const price = resolvePromotionPrice(
      {
        fullPrice: 10_000,
        loyaltyPrice: 8_500,
        linearPromotions: [
          {
            discountPct: 10,
            priority: 5,
            startsAt: "2026-07-01",
            endsAt: "2026-07-31",
          },
          {
            discountPct: 20,
            priority: 1,
            startsAt: "2026-07-01",
            endsAt: "2026-07-31",
          },
        ],
      },
      { now, loggedIn: true, maxDiscountPct: 20 },
    );
    expect(price.effective).toBe(8_000);
    expect(price.discountPct).toBe(20);
    expect(price.kind).toBe("linear");
  });

  it("does not apply loyalty to an anonymous customer", () => {
    const price = resolvePromotionPrice(
      { fullPrice: 10_000, loyaltyPrice: 8_000 },
      { now, loggedIn: false },
    );
    expect(price.effective).toBe(10_000);
  });
});
