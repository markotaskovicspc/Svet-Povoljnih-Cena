import { describe, expect, it } from "vitest";
import { calculatePublishedDeliveryTariffQuote } from "@/lib/delivery-tariff";

const article = {
  qty: 1, unitPrice: 500,
  unitPackWidthCm: 50, unitPackDepthCm: 40, unitPackHeightCm: 30,
};
const options = { loggedIn: false };

describe("customer delivery weight allowance", () => {
  it("uses 6 kg and the next tariff band for a 5 kg article without mutating it", () => {
    const product = { ...article, grossWeightKg: 5 };
    for (let attempt = 0; attempt < 2; attempt++) {
      const quote = calculatePublishedDeliveryTariffQuote([product], options);
      expect(quote.categories?.[1]).toEqual({ weightKg: 6, subtotal: 500, price: 399 });
      expect(quote.total).toBe(399);
    }
    expect(product.grossWeightKg).toBe(5);
  });

  it.each([
    { grossWeightKg: 5, weightKg: 4, packQty: 10, packGrossWeightKg: 80 },
    { grossWeightKg: 0, weightKg: 5 },
    { packQty: 4, packGrossWeightKg: 20 },
  ])("applies the same allowance to each supported weight source: %j", (source) => {
    const quote = calculatePublishedDeliveryTariffQuote([{ ...article, ...source, qty: 2 }], options);
    expect(quote.categories?.[1].weightKg).toBe(12);
    expect(quote.total).toBe(599);
  });

  it("preserves an exact adjusted tariff boundary after adding decimal weights", () => {
    const quote = calculatePublishedDeliveryTariffQuote([
      { ...article, grossWeightKg: 0.1, qty: 10 },
      { ...article, grossWeightKg: 0.4, qty: 10 },
    ], options);
    expect(quote.categories?.[1].weightKg).toBe(6);
    expect(quote.total).toBe(399);
    const boundary = calculatePublishedDeliveryTariffQuote([
      { ...article, grossWeightKg: 2.5, qty: 10 },
    ], options);
    expect(boundary.categories?.[1].weightKg).toBe(30);
    expect(boundary.total).toBe(899);
  });
});
