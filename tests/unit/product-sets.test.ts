import { describe, expect, it } from "vitest";
import { allocateSetPrice, expandSetLines, productSetInputSchema, setStock, type SetDefinition } from "@/lib/product-sets/core";
import { computeOrderPricing } from "@/lib/pricing";
const set: SetDefinition = { id: "dining", active: true, name: "Trpezarijski set", components: [{ sku: "TABLE", quantity: 1, unitPrice: 10000.01 }, { sku: "CHAIR", quantity: 4, unitPrice: 1999.99 }] };

describe("exact product set pricing", () => {
  it("allocates the entered total proportionally and preserves every cent", () => {
    const components = [{ quantity: 1, weight: 10000 }, { quantity: 4, weight: 2000 }];
    for (const price of [17999, 17999.01, 999.99, 12345.67]) {
      const allocation = allocateSetPrice(price, components);
      expect(allocation.every(p => p > 0)).toBe(true);
      expect(allocation.reduce((total, p, i) => total + Math.round(p * 100) * components[i].quantity, 0)).toBe(Math.round(price * 100));
    }
  });
  it("finds exact allocations when no component has quantity one", () => {
    const allocations = allocateSetPrice(100.01, [{ quantity: 2, weight: 10 }, { quantity: 3, weight: 10 }]);
    expect(Math.round(allocations[0] * 100) * 2 + Math.round(allocations[1] * 100) * 3).toBe(10001);
  });
  it("rejects an impossible fractional allocation rather than changing the total", () => {
    expect(() => allocateSetPrice(100.01, [{ quantity: 2, weight: 10 }, { quantity: 4, weight: 10 }])).toThrow("tačno raspodeliti");
  });
  it("does not round a set allocation or apply individual loyalty/action promotions", () => {
    const result = computeOrderPricing({ lines: set.components.map(c => ({ sku: c.sku, qty: c.quantity * 2, product: { fullPrice: 20000, fixedSetPrice: c.unitPrice, salePrice: 1, loyaltyPrice: 2, loyaltyEligible: true } })) });
    expect(result.lines.map(l => l.unitPriceSale)).toEqual([10000.01, 1999.99]);
    expect(result.subtotal).toBeCloseTo((10000.01 + 4 * 1999.99) * 2, 2);
  });
});

describe("atomic set basket", () => {
  it("expands real component quantities and uses stored prices, keeping other products separate", () => {
    const expanded = expandSetLines([{ sku: "set:dining", qty: 2 }, { sku: "LAMP", qty: 1 }], [set]);
    expect(expanded.lines).toEqual([{ sku: "TABLE", qty: 2 }, { sku: "CHAIR", qty: 8 }, { sku: "LAMP", qty: 1 }]);
    expect(expanded.prices.get("CHAIR")).toBe(1999.99);
    expect(expanded.prices.has("LAMP")).toBe(false);
  });
  it("prevents a standalone component receiving a set discount", () => {
    expect(expandSetLines([{ sku: "CHAIR", qty: 4 }], [set]).prices.size).toBe(0);
  });
  it("rejects overlap rather than overwriting reservation lines", () => {
    expect(() => expandSetLines([{ sku: "CHAIR", qty: 1 }, { sku: "set:dining", qty: 1 }], [set])).toThrow("više stavki");
  });
  it("rejects deactivated or missing sets and quantities exceeding component cap", () => {
    expect(() => expandSetLines([{ sku: "set:dining", qty: 1 }], [{ ...set, active: false }])).toThrow("više nije dostupan");
    expect(() => expandSetLines([{ sku: "set:missing", qty: 1 }], [set])).toThrow("više nije dostupan");
    expect(() => expandSetLines([{ sku: "set:dining", qty: 25 }], [set])).toThrow("najviše 99");
  });
  it("derives bottleneck stock from component requirements", () => {
    expect(setStock([{ quantity: 1, available: 10 }, { quantity: 4, available: 11 }])).toBe(2);
    expect(setStock([{ quantity: 1, available: 10 }, { quantity: 4, available: 0 }])).toBe(0);
    expect(setStock([])).toBe(0);
  });
  it("validates composition before persistence", () => {
    const input = { name: "Set", slug: "set", description: "", active: false, price: 100, components: [{ sku: "TABLE", quantity: 1 }, { sku: "CHAIR", quantity: 4 }] };
    expect(productSetInputSchema.safeParse(input).success).toBe(true);
    expect(productSetInputSchema.safeParse({ ...input, components: [input.components[0], input.components[0]] }).success).toBe(false);
    expect(productSetInputSchema.safeParse({ ...input, price: 1.111 }).success).toBe(false);
  });
});
