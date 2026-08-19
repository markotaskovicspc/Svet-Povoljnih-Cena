import { describe, expect, it } from "vitest";
import {
  CartLoginOfferLink,
  getCartLoginOfferDetails,
} from "@/components/cart/cart-view";
import type { CartLine } from "@/lib/hooks/use-cart";

function cartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    sku: "110176",
    name: "Trosed RELAXO",
    slug: "trosed-relaxo",
    qty: 1,
    unitPriceFull: 20_406,
    unitPriceSale: 14_284,
    ...overrides,
  };
}

describe("cart login offer", () => {
  it("passes the drawer close callback to the login link", () => {
    const onNavigate = () => undefined;
    const link = CartLoginOfferLink({ onNavigate });
    const props = link.props as { href: string; onClick?: () => void };

    expect(props.href).toBe("/nalog/prijava?callbackUrl=%2Fkorpa");
    expect(props.onClick).toBe(onNavigate);
  });

  it("keeps the 30% login message available before loyalty prices load", () => {
    expect(getCartLoginOfferDetails([cartLine()])).toEqual({
      discountPct: 30,
      potentialSavings: 0,
    });
  });

  it("calculates the available loyalty saving when the cart has eligible items", () => {
    expect(
      getCartLoginOfferDetails([
        cartLine({
          qty: 2,
          unitPriceSale: 10_000,
          unitPriceLoyalty: 7_000,
          loyaltyDiscountPct: 30,
        }),
      ]),
    ).toEqual({
      discountPct: 30,
      potentialSavings: 6_000,
    });
  });
});
