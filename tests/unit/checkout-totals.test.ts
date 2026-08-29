import { describe, expect, it } from "vitest";
import { computeTotals } from "@/components/checkout/order-summary";

describe("checkout totals", () => {
  it("does not present a payable total when delivery is not priced", () => {
    expect(
      computeTotals({
        itemsFull: 59_599,
        itemsSale: 41_719,
        shippingMethod: "kurir",
        assemblyTotal: 0,
        voucherDiscountRsd: 0,
        shippingPrices: { kurir: null, kamion: null },
      }),
    ).toMatchObject({
      itemsFull: 59_599,
      itemsSale: 41_719,
      savings: 17_880,
      shipping: null,
      total: null,
    });
  });

  it("shows and subtracts the server-resolved first-purchase discount", () => {
    expect(
      computeTotals({
        itemsFull: 2_000,
        itemsSale: 1_000,
        shippingMethod: "kurir",
        assemblyTotal: 0,
        voucherDiscountRsd: 100,
        firstPurchaseEligible: true,
        shippingPrices: { kurir: 300, kamion: null },
      }),
    ).toMatchObject({
      voucherDiscount: 100,
      firstPurchaseDiscount: 150,
      total: 1_050,
    });
  });

  it("keeps the voucher and first-purchase stack inside the merchandise subtotal", () => {
    const totals = computeTotals({
      itemsFull: 1_000,
      itemsSale: 1_000,
      shippingMethod: "kurir",
      assemblyTotal: 0,
      voucherDiscountRsd: 1_000,
      firstPurchaseEligible: true,
      shippingPrices: { kurir: 300, kamion: null },
    });

    expect(totals.voucherDiscount + totals.firstPurchaseDiscount).toBe(1_000);
    expect(totals.total).toBe(300);
  });
});
