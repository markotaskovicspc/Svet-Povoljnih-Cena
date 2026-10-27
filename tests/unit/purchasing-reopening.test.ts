import { describe, expect, it } from "vitest";
import { purchasingCorrectionBalance, readPurchasingReopening, withPurchasingReopening } from "@/lib/admin/purchasing-reopening";

const base = { sku: "A", stock: 40, cogs: 100, previousQty: 10, previousCostRsd: 1000, qty: 10, costRsd: 1000 };

describe("reopening a received purchase without receiving it twice", () => {
  it("keeps a header-only correction unchanged", () => {
    expect(purchasingCorrectionBalance(base)).toEqual({ qtyDelta: 0, stock: 40, cogs: 100 });
    expect(purchasingCorrectionBalance({ ...base, cogs: null }).cogs).toBeNull();
  });
  it("applies only the new quantity and cost differences after earlier sales", () => {
    expect(purchasingCorrectionBalance({ ...base, qty: 12, costRsd: 1440 })).toEqual({ qtyDelta: 2, stock: 42, cogs: 105.71 });
    expect(purchasingCorrectionBalance({ ...base, costRsd: 1200 })).toEqual({ qtyDelta: 0, stock: 40, cogs: 105 });
  });
  it("supports removed lines and newly added products", () => {
    expect(purchasingCorrectionBalance({ ...base, qty: 0, costRsd: 0 })).toEqual({ qtyDelta: -10, stock: 30, cogs: 100 });
    expect(purchasingCorrectionBalance({ ...base, stock: 0, cogs: null, previousQty: 0, previousCostRsd: 0, qty: 5, costRsd: 1000 })).toEqual({ qtyDelta: 5, stock: 5, cogs: 200 });
  });
  it("rejects unavailable quantities and negative inventory valuation", () => {
    expect(() => purchasingCorrectionBalance({ ...base, stock: 2, qty: 1, costRsd: 100 })).toThrow("zaliha");
    expect(() => purchasingCorrectionBalance({ ...base, stock: 1, costRsd: 0 })).toThrow("negativan COGS");
    expect(() => purchasingCorrectionBalance({ ...base, cogs: null, costRsd: 1200 })).toThrow("Nedostaje");
  });
  it("does not rewrite the cost of already sold units when no stock remains", () => {
    expect(purchasingCorrectionBalance({ ...base, stock: 0, costRsd: 1200 })).toEqual({ qtyDelta: 0, stock: 0, cogs: 100 });
  });
  it("preserves the original booking snapshot and rejects corrupted correction baselines", () => {
    const original = { version: 1, products: [{ stock: 30, cogs: 100 }] };
    const reopening = { version: 1 as const, token: "fd791d1c-219f-490f-a535-d7db01fa6b39", invoiceId: "i", warehouseId: "dc", supplierId: "s", products: [{ productId: "a", sku: "A", qty: 10, costRsd: 1000 }] };
    const snapshot = withPurchasingReopening(original, reopening);
    expect(readPurchasingReopening(snapshot)).toEqual(reopening);
    expect(withPurchasingReopening(snapshot, null)).toEqual(original);
    expect(readPurchasingReopening(original)).toBeNull();
    expect(() => readPurchasingReopening({ reopening: null })).toThrow("Snimak");
    expect(() => readPurchasingReopening({ reopening: { ...reopening, products: [...reopening.products, ...reopening.products] } })).toThrow("Snimak");
  });
});
