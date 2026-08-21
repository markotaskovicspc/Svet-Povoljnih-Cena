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
});
