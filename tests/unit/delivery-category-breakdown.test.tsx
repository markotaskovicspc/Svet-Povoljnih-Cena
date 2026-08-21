import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeliveryCategoryBreakdown } from "@/components/cart/delivery-category-breakdown";

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

  it("explains an unpriced overweight category", () => {
    const html = renderToStaticMarkup(
      <dl>
        <DeliveryCategoryBreakdown
          breakdown={{
            1: { weightKg: 0, subtotal: 0, price: 0 },
            2: { weightKg: 67, subtotal: 33_000, price: null },
          }}
        />
      </dl>,
    );

    expect(html).toContain("II kategorija (67 kg)");
    expect(html).toContain("Nije obračunato");
  });
});
