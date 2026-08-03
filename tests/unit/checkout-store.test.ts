import { afterEach, describe, expect, it } from "vitest";
import { useCheckout } from "@/lib/checkout/store";
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
    checkout.applyVoucher({ code: "QA", discountRsd: 100, label: "−100 RSD" });
    checkout.setLastOrder(placedOrder);

    useCheckout.getState().resetProgress();

    expect(useCheckout.getState()).toMatchObject({
      step: "identity",
      identity: "guest",
      voucher: null,
      lastOrder: placedOrder,
    });
  });
});
