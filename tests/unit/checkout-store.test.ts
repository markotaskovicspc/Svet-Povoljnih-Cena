import { afterEach, describe, expect, it } from "vitest";
import {
  useCheckout,
  voucherDiscountForSubtotal,
} from "@/lib/checkout/store";
import type { Order } from "@/types";

afterEach(() => {
  useCheckout.getState().reset();
});

describe("checkout progress reset", () => {
  it("prepares a new checkout without removing the placed order snapshot", () => {
    const placedOrder = { id: "SPC-QA-NAVIGATION" } as Order;
    const checkout = useCheckout.getState();
    checkout.setStep("review");
    checkout.setIdentity("login");
    checkout.applyVoucher({
      code: "QA",
      discountRsd: 100,
      label: "−100 RSD",
      validatedSubtotalRsd: 1_000,
    });
    checkout.setLastOrder(placedOrder);

    useCheckout.getState().resetProgress();

    expect(useCheckout.getState()).toMatchObject({
      step: "identity",
      identity: "guest",
      voucher: null,
      lastOrder: placedOrder,
    });
  });

  it("never displays a discount calculated for an outdated cart subtotal", () => {
    const voucher = {
      code: "QA",
      discountRsd: 1_500,
      label: "−1.500 RSD",
      validatedSubtotalRsd: 2_000,
    };

    expect(voucherDiscountForSubtotal(voucher, 1_000)).toBe(0);
    expect(voucherDiscountForSubtotal(voucher, 2_000)).toBe(1_500);
    expect(
      voucherDiscountForSubtotal(
        { ...voucher, discountRsd: 3_000 },
        2_000,
      ),
    ).toBe(2_000);
  });
});
