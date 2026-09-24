import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("isFirstPurchaseDiscountEligible", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

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

  it("grants a verified guest the first-purchase benefit and searches both account and guest history", async () => {
    findFirst.mockResolvedValue(null);
    await expect(isFirstPurchaseDiscountEligible(null, " Buyer@Example.com ")).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [
      { guestEmail: { equals: "buyer@example.com", mode: "insensitive" } },
      { user: { email: { equals: "buyer@example.com", mode: "insensitive" } } },
    ] }) }));
    findFirst.mockResolvedValue({ id: "previous-account-sale" });
    await expect(isFirstPurchaseDiscountEligible(null, "buyer@example.com")).resolves.toBe(false);
  });
});
