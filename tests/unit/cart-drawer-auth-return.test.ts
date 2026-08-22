import { describe, expect, it } from "vitest";

import {
  cartDrawerLoginReturnPath,
  consumeCartDrawerReturnMarker,
} from "@/lib/cart/cart-drawer-auth-return";

describe("cart drawer auth return", () => {
  it("marks the current storefront URL for reopening the drawer", () => {
    expect(cartDrawerLoginReturnPath("/novo", "sort=price-asc&page=2")).toBe(
      "/novo?sort=price-asc&page=2&spcCart=open",
    );
  });

  it("replaces an existing marker instead of duplicating it", () => {
    expect(cartDrawerLoginReturnPath("/", "spcCart=closed")).toBe(
      "/?spcCart=open",
    );
  });

  it("consumes only the drawer marker and preserves the rest of the URL", () => {
    expect(
      consumeCartDrawerReturnMarker(
        "https://shop.example/novo?sort=price-asc&spcCart=open#artikli",
      ),
    ).toBe("/novo?sort=price-asc#artikli");
    expect(
      consumeCartDrawerReturnMarker("https://shop.example/novo?spcCart=closed"),
    ).toBeNull();
  });
});
