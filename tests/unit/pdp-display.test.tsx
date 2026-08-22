import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getPdpAvailabilityMessage,
  PdpMobilePriceContent,
} from "@/components/product/pdp-add-to-cart";
import { PdpBenefits } from "@/components/product/pdp-benefits";
import { PdpPictograms } from "@/components/product/pdp-pictograms";
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
    expect(markup).toContain("2+1 garancija");
    expect(markup).toContain("GARANCIJA");
    expect(markup).not.toContain("Sigurna kupovina");
    expect(markup).not.toContain("Precizne dimenzije");
    expect(markup).toContain("md:w-[90%]");
    expect(markup).toContain("text-xs");
    expect(markup).not.toContain("text-[0.6rem]");
  });

  it("renders no more than six product pictograms", () => {
    const markup = renderToStaticMarkup(
      <PdpPictograms
        className="absolute top-3 right-3"
        pictograms={Array.from({ length: 7 }, (_, index) => ({
          id: String(index),
          code: `icon-${index}`,
          label: `Oznaka ${index}`,
          iconUrl: "/brand/pictograms/rabalux/led.png",
        }))}
      />,
    );
    expect(markup.match(/<li/g)).toHaveLength(6);
    expect(markup).not.toContain("Oznaka 6");
    expect(markup).toContain("absolute top-3 right-3");
    expect(markup.match(/sr-only/g)).toHaveLength(6);
    expect(markup).not.toContain("text-\[10px\]");
  });

  it("marks the delivery pictogram placement for the gallery corner", () => {
    const markup = renderToStaticMarkup(
      <PdpPictograms
        placement="delivery"
        className="absolute right-3 bottom-3"
        pictograms={[
          {
            id: "delivery-48h",
            code: "48h",
            label: "48h",
            iconUrl: "https://example.test/delivery.png",
          },
        ]}
      />,
    );

    expect(markup).toContain('data-pdp-pictogram-placement="delivery"');
    expect(markup).toContain("absolute right-3 bottom-3");
    expect(markup).toContain("48h");
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

  it("shows the same ordinary-stock message returned by the availability API", () => {
    const availability = getProductAvailability({
      stock: 8,
      incomingStock: 0,
      fullPrice: product.fullPrice,
      dimensionsCm: { w: 60, d: 65, h: 130 },
      media: { images: [{ url: "/game-throne.jpg" }] },
      deliveryDays: product.deliveryDays,
      availabilitySource: "DC",
    });

    expect(availability.message).toBe("Spremno za poručivanje");
    expect(getPdpAvailabilityMessage(product, availability)).toBe(
      availability.message,
    );
  });
});
