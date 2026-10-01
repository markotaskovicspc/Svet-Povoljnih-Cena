import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    order: { findFirst },
    user: { findUnique: vi.fn().mockResolvedValue({ email: "buyer@example.com" }) },
  },
}));

import { isFirstPurchaseDiscountEligible } from "@/lib/checkout/first-purchase.server";
import { computeOrderPricing } from "@/lib/pricing/engine";
import { OCTOBER_TERMS_AT_MS } from "@/lib/commerce-terms";

describe("isFirstPurchaseDiscountEligible", () => {
  beforeEach(() => {
    findFirst.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(OCTOBER_TERMS_AT_MS - 1);
  });
  afterEach(() => vi.useRealTimers());

  it("does not grant the customer-only offer to guests", async () => {
    await expect(isFirstPurchaseDiscountEligible(null)).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("grants the offer while the customer has no issued sale receipt", async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      isFirstPurchaseDiscountEligible("customer-1"),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: "customer-1" },
          { guestEmail: { equals: "buyer@example.com", mode: "insensitive" } },
          { user: { email: { equals: "buyer@example.com", mode: "insensitive" } } },
        ],
        fiscalDocuments: {
          some: { kind: "SALE", status: "ISSUED" },
        },
      },
      select: { id: true },
    });
  });

  it("consumes the offer after the first issued sale receipt", async () => {
    findFirst.mockResolvedValue({ id: "order-1" });

    await expect(
      isFirstPurchaseDiscountEligible("customer-1"),
    ).resolves.toBe(false);
  });

  it("keeps the September guest benefit until midnight and searches account and guest history", async () => {
    findFirst.mockResolvedValue(null);
    await expect(isFirstPurchaseDiscountEligible(null, " Buyer@Example.com ")).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [
      { guestEmail: { equals: "buyer@example.com", mode: "insensitive" } },
      { user: { email: { equals: "buyer@example.com", mode: "insensitive" } } },
    ] }) }));
    findFirst.mockResolvedValue({ id: "previous-account-sale" });
    await expect(isFirstPurchaseDiscountEligible(null, "buyer@example.com")).resolves.toBe(false);
  });

  it("at midnight removes the extra discount from guests/channel members but keeps their 30% loyalty price", async () => {
    findFirst.mockResolvedValue(null);
    const lines = [{ sku: "TEST", qty: 1, product: { fullPrice: 10_000, loyaltyDiscountPct: 30, loyaltyEligible: true } }];
    const before = await isFirstPurchaseDiscountEligible(null, "buyer@example.com");
    expect(computeOrderPricing({ lines, eligibility: { firstPurchase: before } }).firstPurchaseDiscount).toBe(1050);
    vi.setSystemTime(OCTOBER_TERMS_AT_MS);
    findFirst.mockClear();
    // The same email may belong to an account: only an authenticated userId qualifies.
    const guest = await isFirstPurchaseDiscountEligible(null, "buyer@example.com");
    expect(guest).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
    expect(computeOrderPricing({ lines, eligibility: { firstPurchase: guest } })).toMatchObject({ subtotal: 7000, firstPurchaseDiscount: 0 });
    const loggedIn = await isFirstPurchaseDiscountEligible("customer-1");
    expect(computeOrderPricing({ lines, eligibility: { firstPurchase: loggedIn } })).toMatchObject({ subtotal: 7000, firstPurchaseDiscount: 700 });
    findFirst.mockResolvedValue({ id: "previous-guest-sale" });
    expect(await isFirstPurchaseDiscountEligible("customer-1")).toBe(false);
  });
});
