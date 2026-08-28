import { describe, expect, it } from "vitest";
import { getCrossSellContinueLabel } from "@/lib/cross-sell";

describe("cross-sell destination label", () => {
  it("uses a cart-specific label for add-to-cart and cart flows", () => {
    expect(getCrossSellContinueLabel(null)).toBe("Nastavi ka korpi");
    expect(getCrossSellContinueLabel("/korpa")).toBe("Nastavi ka korpi");
  });

  it("uses a checkout-specific label when checkout becomes the destination", () => {
    expect(getCrossSellContinueLabel("/checkout/podaci")).toBe(
      "Nastavi na plaćanje",
    );
  });
});
