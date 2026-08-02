import { describe, expect, it } from "vitest";
import { resolveProductPriceQuote, resolvePromotionPrice } from "@/lib/pricing";

const now = new Date("2026-07-18T12:00:00.000Z");

describe("ERP pricing precedence", () => {
  it("uses the highest-priority live product action and stacks a linear promotion", () => {
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
    expect(price.effective).toBe(7_000);
    expect(price.kind).toBe("sale");
    expect(price.linearDiscountPct).toBe(20);
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
    expect(price.kind).toBe("loyalty");
  });

  it("does not apply loyalty to an anonymous customer", () => {
    const price = resolvePromotionPrice(
      { fullPrice: 10_000, loyaltyPrice: 8_000 },
      { now, loggedIn: false },
    );
    expect(price.effective).toBe(10_000);
  });

  it("shows loyalty publicly but only charges it to an authenticated customer", () => {
    const guest = resolveProductPriceQuote(
      { fullPrice: 10_000, loyaltyPrice: 8_000 },
      { now, loggedIn: false },
    );
    expect(guest.loyaltyOffer?.effective).toBe(8_000);
    expect(guest.payable.effective).toBe(10_000);

    const customer = resolveProductPriceQuote(
      { fullPrice: 10_000, loyaltyPrice: 8_000 },
      { now, loggedIn: true },
    );
    expect(customer.payable.kind).toBe("loyalty");
    expect(customer.payable.effective).toBe(8_000);
  });

  it("uses an active action instead of loyalty, even when loyalty would be lower", () => {
    const quote = resolveProductPriceQuote(
      {
        fullPrice: 10_000,
        loyaltyPrice: 7_500,
        actionPrices: [
          {
            price: 8_000,
            priority: 10,
            startsAt: "2026-07-01",
            endsAt: "2026-07-31",
          },
        ],
      },
      { now, loggedIn: true },
    );
    expect(quote.actionOffer?.effective).toBe(8_000);
    expect(quote.loyaltyOffer).toBeNull();
    expect(quote.payable.effective).toBe(8_000);
    expect(quote.payable.kind).toBe("sale");
  });

  it("restores loyalty after the product action expires", () => {
    const quote = resolveProductPriceQuote(
      {
        fullPrice: 10_000,
        loyaltyPrice: 8_000,
        actionPrices: [
          {
            price: 7_000,
            priority: 10,
            startsAt: "2026-06-01",
            endsAt: "2026-06-30",
          },
        ],
      },
      { now, loggedIn: true },
    );
    expect(quote.actionOffer).toBeNull();
    expect(quote.loyaltyOffer?.effective).toBe(8_000);
    expect(quote.payable.kind).toBe("loyalty");
  });

  it("treats TNC membership as a regular price instead of an action price", () => {
    const quote = resolveProductPriceQuote(
      {
        fullPrice: 10_000,
        loyaltyPrice: 8_500,
        action: {
          name: "Trajno niska cena",
          startsAt: "2026-01-01",
          endsAt: "2026-12-31",
          isPermanent: true,
        },
        actionPrices: [
          {
            price: 7_000,
            priority: 100,
            startsAt: "2026-01-01",
            endsAt: "2026-12-31",
            isPermanent: true,
          },
        ],
      },
      { now, loggedIn: true },
    );

    expect(quote.actionOffer).toBeNull();
    expect(quote.loyaltyOffer?.effective).toBe(8_500);
    expect(quote.payable.kind).toBe("loyalty");
  });

  it("breaks equal action priorities by newer start and then lower price", () => {
    const newer = resolvePromotionPrice(
      {
        fullPrice: 10_000,
        actionPrices: [
          {
            price: 7_000,
            priority: 5,
            startsAt: "2026-07-01",
            endsAt: "2026-07-31",
            actionId: "older",
            actionName: "Starija akcija",
          },
          {
            price: 8_000,
            priority: 5,
            startsAt: "2026-07-10",
            endsAt: "2026-07-31",
            actionId: "newer",
            actionName: "Novija akcija",
          },
        ],
      },
      { now },
    );
    expect(newer.effective).toBe(8_000);
    expect(newer.actionName).toBe("Novija akcija");

    const lower = resolvePromotionPrice(
      {
        fullPrice: 10_000,
        actionPrices: [
          {
            price: 8_000,
            priority: 5,
            startsAt: "2026-07-10",
            endsAt: "2026-07-31",
            actionId: "higher-price",
          },
          {
            price: 7_500,
            priority: 5,
            startsAt: "2026-07-10",
            endsAt: "2026-07-31",
            actionId: "lower-price",
          },
        ],
      },
      { now },
    );
    expect(lower.effective).toBe(7_500);
  });
});
