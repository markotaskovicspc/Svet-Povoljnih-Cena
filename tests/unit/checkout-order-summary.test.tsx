import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderSummary } from "@/components/checkout/order-summary";
import type { CheckoutDeliveryQuote } from "@/lib/checkout/config-shared";
import { useCheckout } from "@/lib/checkout/store";
import { useCart } from "@/lib/hooks/use-cart";

const deliveryQuote: CheckoutDeliveryQuote = {
  prices: { kurir: 990, kamion: null },
  recommendedMethod: "kurir",
  pricingIssue: null,
  deliveryCategoriesBySku: {},
  deliveryCategoryBreakdown: null,
  assemblyPrice: 0,
  assemblyPricesBySku: {},
  truckAvailable: false,
  truckCities: [],
};

afterEach(() => {
  useCart.setState({ hydrated: false, lines: [] });
  useCheckout.setState({ voucher: null });
});

describe("checkout order summary", () => {
  it("does not flash the fallback delivery price while the live quote loads", () => {
    useCart.setState({
      hydrated: true,
      lines: [
        {
          sku: "110054",
          slug: "power-mop",
          name: "Set za čišćenje POWER MOP",
          qty: 3,
          unitPriceFull: 1_427,
          unitPriceSale: 790,
        },
      ],
    });

    const markup = renderToStaticMarkup(
      <OrderSummary
        deliveryQuote={deliveryQuote}
        deliveryQuoteStatus="loading"
        shippingMethod="kurir"
      />,
    );

    expect(markup).toContain("Obračunavam…");
    expect(markup).not.toContain("990 RSD");
    expect(markup).not.toContain("3.360 RSD");
  });
});
