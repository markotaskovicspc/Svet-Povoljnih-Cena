import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeliveryCategoryBreakdown } from "@/components/cart/delivery-category-breakdown";
import { calculatePublishedDeliveryTariffQuote } from "@/lib/delivery-tariff";

describe("delivery category breakdown", () => {
  it("shows both category weights and the independently calculated prices", () => {
    const html = renderToStaticMarkup(
      <dl>
        <DeliveryCategoryBreakdown
          breakdown={{
            1: { weightKg: 4, subtotal: 2_500, price: 0 },
            2: { weightKg: 6, subtotal: 4_000, price: 799 },
          }}
        />
      </dl>,
    );

    expect(html).toContain("I kategorija (4 kg)");
    expect(html).toContain("Besplatno");
    expect(html).toContain("II kategorija (6 kg)");
    expect(html).toContain("799 RSD");
  });

  it("shows both categories when mixed cart lines use the 1 kg fallback", () => {
    const quote = calculatePublishedDeliveryTariffQuote(
      [
        {
          qty: 2,
          unitPrice: 2_000,
          unitPackWidthCm: 50,
          unitPackDepthCm: 40,
          unitPackHeightCm: 30,
        },
        {
          qty: 3,
          unitPrice: 4_000,
          unitPackWidthCm: 101,
          unitPackDepthCm: 60,
          unitPackHeightCm: 40,
        },
      ],
      {
        loggedIn: true,
        at: new Date("2026-09-01T00:01:00+02:00"),
      },
    );
    const html = renderToStaticMarkup(
      <dl>
        <DeliveryCategoryBreakdown breakdown={quote.categories} />
      </dl>,
    );

    expect(quote).toMatchObject({
      total: 699,
      issue: null,
      categories: {
        1: { weightKg: 2, subtotal: 4_000, price: 0 },
        2: { weightKg: 3, subtotal: 12_000, price: 699 },
      },
    });
    expect(html).toContain("I kategorija (2 kg)");
    expect(html).toContain("Besplatno");
    expect(html).toContain("II kategorija (3 kg)");
    expect(html).toContain("699 RSD");
  });

  it("shows the extended category-II price above 50 kg", () => {
    const quote = calculatePublishedDeliveryTariffQuote(
      [
        {
          qty: 1,
          unitPrice: 33_000,
          unitPackWidthCm: 180,
          unitPackDepthCm: 100,
          unitPackHeightCm: 20,
          grossWeightKg: 67,
        },
      ],
      { loggedIn: false },
    );
    const html = renderToStaticMarkup(
      <dl>
        <DeliveryCategoryBreakdown breakdown={quote.categories} />
      </dl>,
    );

    expect(quote.total).toBe(1_699);
    expect(html).toContain("II kategorija (67 kg)");
    expect(html).toContain("1.699 RSD");
  });
});
