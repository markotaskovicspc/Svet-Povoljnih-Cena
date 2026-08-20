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
});
