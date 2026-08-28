import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CartLoginOfferCopy,
  CartLoginOfferLink,
} from "@/components/cart/cart-view";

describe("cart login offer", () => {
  it("shows red uppercase offers followed by black eligibility notes", () => {
    const markup = renderToStaticMarkup(createElement(CartLoginOfferCopy));

    const loyaltyHeadline = markup.indexOf(
      "PRIJAVITE SE I OSTVARITE 30% LOYALTY POPUSTA</span> <span class=\"text-ink-900\">(Važi za artikle koji nisu na akciji)",
    );
    const firstPurchaseCopy = markup.indexOf(
      "15% POPUSTA ZA PRVU KUPOVINU SE OBRAČUNAVA NAKON POTVRDE PORUDŽBINE</span> <span class=\"text-ink-900\">(Važi za ulogovane korisnike)",
    );

    expect(loyaltyHeadline).toBeGreaterThanOrEqual(0);
    expect(firstPurchaseCopy).toBeGreaterThan(loyaltyHeadline);
    expect(markup.match(/text-action/g)).toHaveLength(2);
    expect(markup.match(/text-ink-900/g)).toHaveLength(2);
    expect(markup.match(/uppercase/g)).toHaveLength(2);
  });

  it("passes the drawer close callback to the login link", () => {
    const onNavigate = () => undefined;
    const link = CartLoginOfferLink({ onNavigate });
    const props = link.props as { href: string; onClick?: () => void };

    expect(props.href).toBe("/nalog/prijava?callbackUrl=%2Fkorpa");
    expect(props.onClick).toBe(onNavigate);
  });
});
