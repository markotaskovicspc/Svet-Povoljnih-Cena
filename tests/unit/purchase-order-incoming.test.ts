import { describe, expect, it } from "vitest";
import { incomingWarehouseKey, summarizeArticleIncoming, summarizePurchaseOrderIncoming, type IncomingPurchaseOrderLine } from "@/lib/admin/purchase-order-incoming";

const line = (overrides: Partial<IncomingPurchaseOrderLine> = {}): IncomingPurchaseOrderLine => ({
  productId: "article", warehouseId: "dc", qty: 10, receivedQty: 0,
  deliveryDate: new Date("2026-11-10T00:00:00Z"), status: "DRAFT", ...overrides,
});
const summarize = (lines: IncomingPurchaseOrderLine[], stored = 0, defaultWarehouseId: string | null = "dc") =>
  summarizePurchaseOrderIncoming({ lines, storedIncoming: [{ productId: "article", incomingStock: stored }], defaultWarehouseId });

describe("read-only planned PO incoming summary", () => {
  it("counts remainders from every non-cancelled status and ignores completed/overreceived lines", () => {
    const rows = [line(), line({ status: "SENT" }), line({ status: "CONFIRMED" }),
      line({ status: "RECEIVED", receivedQty: 6 }), line({ status: "CANCELLED" }),
      line({ receivedQty: 10 }), line({ receivedQty: 12 })];
    expect(summarize(rows).get("article:dc")).toMatchObject({ incoming: 34, firstIncomingQty: 34, firstIncomingDate: "2026-11-10" });
    expect(rows[0].qty).toBe(10);
  });

  it("groups the earliest known calendar day regardless of line order and keeps undated remainder separate", () => {
    const rows = [line({ deliveryDate: new Date("2026-11-12") }),
      line({ qty: 5, deliveryDate: new Date("2026-11-03T18:00:00Z") }),
      line({ qty: 8, receivedQty: 2, deliveryDate: new Date("2026-11-03T00:00:00Z") }),
      line({ deliveryDate: null }), line({ status: "CANCELLED", deliveryDate: new Date("2026-01-01") })];
    expect(summarize(rows).get("article:dc")).toMatchObject({ incoming: 31, firstIncomingDate: "2026-11-03", firstIncomingQty: 11 });
    expect(summarize([...rows].reverse())).toEqual(summarize(rows));
  });

  it("subtracts all destinations before assigning a legacy residual only to DC total", () => {
    const result = summarize([line(), line({ qty: 20, warehouseId: "other", deliveryDate: new Date("2026-11-01") })], 50);
    expect(result.get("article:dc")).toMatchObject({ incoming: 30, firstIncomingDate: "2026-11-10", firstIncomingQty: 10 });
    expect(result.get("article:other")).toMatchObject({ incoming: 20, firstIncomingDate: "2026-11-01", firstIncomingQty: 20 });
  });

  it("does not invent dates from a stored-only quantity or invalid dates", () => {
    expect(summarize([], 7).get("article:dc")).toMatchObject({ incoming: 7, firstIncomingDate: null, firstIncomingQty: null });
    expect(summarize([line({ deliveryDate: new Date("invalid") })]).get("article:dc")).toMatchObject({ incoming: 10, firstIncomingDate: null, firstIncomingQty: null });
  });

  it("preserves the existing DC fallback for null or inactive destination warehouses", () => {
    const result = summarize([line({ warehouseId: null, qty: 2 }), line({ warehouseId: "old", warehouseActive: false, qty: 3 })]);
    expect([...result.values()]).toEqual([{ productId: "article", warehouseId: "dc", incoming: 5, firstIncomingDate: "2026-11-10", firstIncomingQty: 5 }]);
    expect(summarize([line({ warehouseId: null })], 5, null).size).toBe(0);
  });

  it("keeps products separate and has no arbitrary line cap", () => {
    const rows = Array.from({ length: 1500 }, () => line({ qty: 1 }));
    const result = summarize([...rows, line({ productId: "second", qty: 2 })]);
    expect(result.get(incomingWarehouseKey("article", "dc"))?.incoming).toBe(1500);
    expect(result.get(incomingWarehouseKey("second", "dc"))?.incoming).toBe(2);
  });

  it("projects card data to default DC, with archived/unlocked/uninvoiced and RECEIVED remainders included", () => {
    const po = (status: string, deliveryDate: string | null, receivingWarehouse: { id: string; active: boolean } | null) => ({
      status, deliveryDate: deliveryDate ? new Date(deliveryDate) : null, receivingWarehouse,
      archivedAt: new Date("2026-01-01"), lockedAt: null, inboundInvoices: [],
    });
    const product = { id: "article", incomingStock: 40, purchaseOrderItems: [
      { qty: 12, receivedQty: 2, purchaseOrder: po("RECEIVED", "2026-11-10", { id: "dc", active: true }) },
      { qty: 7, receivedQty: 0, purchaseOrder: po("DRAFT", "2026-11-01", { id: "other", active: true }) },
      { qty: 3, receivedQty: 0, purchaseOrder: po("SENT", null, null) },
      { qty: 2, receivedQty: 0, purchaseOrder: po("CONFIRMED", "2026-11-10", { id: "old", active: false }) },
      { qty: 100, receivedQty: 0, purchaseOrder: po("CANCELLED", "2026-10-01", null) },
    ] };
    expect(summarizeArticleIncoming(product, "dc")).toEqual({
      productId: "article", warehouseId: "dc", incoming: 33, firstIncomingDate: "2026-11-10", firstIncomingQty: 12,
    });
    expect(summarizeArticleIncoming(product, null)).toBeNull();
  });
});
