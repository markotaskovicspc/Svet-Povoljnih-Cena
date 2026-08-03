import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getPdpAvailabilityMessage,
  PdpMobilePriceContent,
} from "@/components/product/pdp-add-to-cart";
import { PdpBenefits } from "@/components/product/pdp-benefits";
import { PdpPriceContent } from "@/components/product/pdp-price";
import { getProductAvailability } from "@/lib/product-availability";
import type { EffectivePrice, ProductPriceQuote } from "@/lib/pricing";
import type { Product } from "@/types";

const product = {
  fullPrice: 8_999,
  deliveryDays: { min: 2, max: 3 },
} as Product;

function price(overrides: Partial<EffectivePrice>): EffectivePrice {
  return {
    effective: 8_999,
    full: 8_999,
    onSale: false,
    kind: "full",
    discountPct: 0,
    actionExpired: false,
    linearDiscountPct: 0,
    ...overrides,
  };
}

function quote({
  actionOffer = null,
  loyaltyOffer = null,
  payable,
}: {
  actionOffer?: EffectivePrice | null;
  loyaltyOffer?: EffectivePrice | null;
  payable: EffectivePrice;
}): ProductPriceQuote {
  return {
    full: product.fullPrice,
    actionOffer,
    loyaltyOffer,
    payable,
  };
}

describe("PDP price and benefit display", () => {
  it("shows a standalone loyalty price in red without crossing out the regular price", () => {
    const loyaltyOffer = price({ effective: 6_999, kind: "loyalty" });
    const markup = renderToStaticMarkup(
      <PdpPriceContent
        product={product}
        quote={quote({ loyaltyOffer, payable: loyaltyOffer })}
        loyaltyEligible
      />,
    );

    expect(markup).toContain("Redovna cena:");
    expect(markup).toContain("Loyalty cena");
    expect(markup).toContain("text-action");
    expect(markup).not.toContain("line-through");
  });

  it("keeps the regular price crossed out for an active promotion", () => {
    const actionOffer = price({
      effective: 6_999,
      kind: "sale",
      onSale: true,
    });
    const markup = renderToStaticMarkup(
      <PdpPriceContent
        product={product}
        quote={quote({ actionOffer, payable: actionOffer })}
        loyaltyEligible={false}
      />,
    );

    expect(markup).toContain("Akcijska cena");
    expect(markup).toContain("line-through");
  });

  it("shows the regular and highlighted action prices in the mobile bar", () => {
    const actionOffer = price({
      effective: 6_999,
      kind: "sale",
      onSale: true,
    });
    const markup = renderToStaticMarkup(
      <PdpMobilePriceContent
        quote={quote({ actionOffer, payable: actionOffer })}
      />,
    );

    expect(markup).toContain("Redovna:");
    expect(markup).toContain("Akcijska cena");
    expect(markup).toContain("line-through");
    expect(markup).toContain("text-action");
    expect(markup).toContain("8.999 RSD");
    expect(markup).toContain("6.999 RSD");
  });

  it("shows the regular and highlighted loyalty prices in the mobile bar", () => {
    const loyaltyOffer = price({ effective: 6_999, kind: "loyalty" });
    const regularPrice = price({});
    const markup = renderToStaticMarkup(
      <PdpMobilePriceContent
        quote={quote({ loyaltyOffer, payable: regularPrice })}
      />,
    );

    expect(markup).toContain("Redovna:");
    expect(markup).toContain("Loyalty cena");
    expect(markup).not.toContain("line-through");
    expect(markup).toContain("text-[19px]");
    expect(markup).toContain("text-action");
  });

  it("renders exactly the three requested benefit boxes", () => {
    const markup = renderToStaticMarkup(
      <PdpBenefits deliveryDays={product.deliveryDays} />,
    );

    expect(markup.match(/<li/g)).toHaveLength(3);
    expect(markup).toContain("Isporuka 2–3 dana");
    expect(markup).toContain("Povrat bez stresa");
    expect(markup).toContain("Sigurna kupovina");
    expect(markup).not.toContain("Garancija");
    expect(markup).not.toContain("Precizne dimenzije");
  });

  it("hides only the generic duplicate availability sentence", () => {
    const availability = getProductAvailability({
      stock: 0,
      incomingStock: 0,
      fullPrice: product.fullPrice,
      dimensionsCm: { w: 60, d: 65, h: 130 },
      media: { images: [{ url: "/game-throne.jpg" }] },
      deliveryDays: product.deliveryDays,
      availabilitySource: "NONE",
    });

    expect(getPdpAvailabilityMessage(product, availability)).toBeNull();
    expect(
      getPdpAvailabilityMessage(product, {
        ...availability,
        addLabel: "U dolasku",
        message: "Sledeći očekivani dolazak: 11. 9. 2026.",
      }),
    ).toBe("Sledeći očekivani dolazak: 11. 9. 2026.");
  });
});
