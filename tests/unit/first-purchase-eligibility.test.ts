import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst } = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    order: { findFirst },
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
        userId: "customer-1",
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
});
