import { describe, expect, it } from "vitest";
import { resolveProductPriceQuote } from "@/lib/pricing";

const now = new Date("2026-08-02T12:00:00.000Z");

describe("global loyalty pricing", () => {
  it("applies loyalty to an authenticated customer when there is no action", () => {
    const quote = resolveProductPriceQuote(
      { fullPrice: 10_000, loyaltyDiscountPct: 10 },
      { now, loggedIn: true },
    );
    expect(quote.loyaltyOffer?.effective).toBe(9_000);
    expect(quote.payable.kind).toBe("loyalty");
  });

  it("stacks loyalty on top of an active product action", () => {
    const quote = resolveProductPriceQuote(
      {
        fullPrice: 10_000,
        loyaltyDiscountPct: 20,
        actionPrices: [
          {
            price: 9_000,
            priority: 1,
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      },
      { now, loggedIn: true },
    );
    expect(quote.loyaltyOffer?.effective).toBe(7_200);
    expect(quote.payable.effective).toBe(7_200);
    expect(quote.payable.kind).toBe("loyalty");
  });

  it("adds the linear discount on top of loyalty when there is no action", () => {
    const quote = resolveProductPriceQuote(
      {
        fullPrice: 10_000,
        loyaltyDiscountPct: 10,
        linearPromotions: [
          {
            discountPct: 5,
            priority: 1,
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      },
      { now, loggedIn: true },
    );
    expect(quote.loyaltyOffer?.effective).toBe(8_550);
    expect(quote.payable.effective).toBe(8_550);
  });
});
