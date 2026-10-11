import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), totals: vi.fn(), incoming: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: mocks.transaction } }));
vi.mock("@/lib/admin/po", () => ({ recomputePurchaseOrderTotals: mocks.totals }));
vi.mock("@/lib/admin/incoming-stock.server", () => ({ recomputeIncomingStockForPurchaseOrders: mocks.incoming }));
import { applyPurchaseOrderImport, purchaseOrderImportPreview } from "@/lib/admin/purchase-order-import.server";

const date = new Date("2026-10-01T00:00:00Z");
const baseOrder = () => ({ id: "po", number: "1/26", status: "DRAFT", lockedAt: null, supplierId: "s1", supplier: { id: "s1", name: "Supplier", enabled: true }, orderDate: date, currency: "EUR", parity: "DAP", totalPrice: 0, items: [] });
const baseProduct = () => ({ id: "p1", sku: "0001", name: "Test", supplierId: "s1", supplier: { id: "s1", parity: "DAP" }, moq: 2, packQty: 2, containerQty: 100, containerGrossWeightKg: 200, fullPrice: 1000, lookupAssignments: [], purchasePrices: [{ id: "price", price: 5, currency: "EUR", parity: "DAP", supplierId: "s1", validFrom: date }] });
const input = [{ row: 2, sku: "0001", qty: 4 }];
function client(order: unknown = baseOrder(), products: unknown[] = [baseProduct()]) {
  return { purchaseOrder: { findUnique: vi.fn().mockResolvedValue(order) }, product: { findMany: vi.fn().mockResolvedValue(products) }, purchaseOrderItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }) }, $queryRaw: vi.fn().mockResolvedValue([{ id: "po" }]) };
}
const asTx = (tx: ReturnType<typeof client>) => tx as unknown as Prisma.TransactionClient;

describe("purchase order bulk import validation and atomic application", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.totals.mockResolvedValue(undefined); mocks.incoming.mockResolvedValue(undefined); });
  it("resolves effective purchase price and computes line snapshots", async () => {
    const tx = client(); const preview = await purchaseOrderImportPreview(asTx(tx), "po", input);
    expect(preview.valid).toBe(true);
    expect(preview.items[0]).toMatchObject({ productId: "p1", qty: 4, purchasePrice: 5, currency: "EUR", parity: "DAP", totalVolume: 2.76, totalWeight: 8 });
    expect(tx.product.findMany.mock.calls[0][0].include.purchasePrices.where).toEqual({ validFrom: { lte: date }, OR: [{ validTo: null }, { validTo: { gte: date } }] });
  });
  it.each(["SENT", "CONFIRMED", "RECEIVED", "CANCELLED"])("blocks %s orders", async status => {
    await expect(purchaseOrderImportPreview(asTx(client({ ...baseOrder(), status })), "po", input)).rejects.toThrow(/U obradi/);
  });
  it("blocks locked drafts and incomplete headers", async () => {
    await expect(purchaseOrderImportPreview(asTx(client({ ...baseOrder(), lockedAt: date })), "po", input)).rejects.toThrow(/neproknjiženu/);
    await expect(purchaseOrderImportPreview(asTx(client({ ...baseOrder(), supplierId: null })), "po", input)).rejects.toThrow(/dobavljača/);
  });
  it.each([
    ["missing SKU", [], /nije pronađena/],
    ["ambiguous SKU", [baseProduct(), { ...baseProduct(), id: "p2" }], /jednoznačna/],
    ["different supplier", [{ ...baseProduct(), supplierId: "s2" }], /dobavljaču/],
    ["no price", [{ ...baseProduct(), purchasePrices: [] }], /važeće nabavne cene/],
    ["different currency", [{ ...baseProduct(), purchasePrices: [{ ...baseProduct().purchasePrices[0], currency: "USD" }] }], /Valuta/],
    ["different parity", [{ ...baseProduct(), purchasePrices: [{ ...baseProduct().purchasePrices[0], parity: "FOB" }] }], /Paritet/],
    ["MOQ", [{ ...baseProduct(), moq: 8 }], /MOQ/],
    ["pack size", [{ ...baseProduct(), packQty: 3 }], /pakovanjem/],
  ])("rejects %s without preparing a partial insert", async (_name, products, error) => {
    const preview = await purchaseOrderImportPreview(asTx(client(baseOrder(), products as unknown[])), "po", input);
    expect(preview.valid).toBe(false); expect(preview.rows[0].error).toMatch(error as RegExp); expect(preview.items).toEqual([]);
  });
  it("rejects existing SKUs while preserving current quantities", async () => {
    const tx = client({ ...baseOrder(), items: [{ id: "line", sku: "0001", productId: "p1", qty: 7 }] });
    expect((await purchaseOrderImportPreview(asTx(tx), "po", input)).rows[0].error).toMatch(/već postoji/);
    expect(tx.purchaseOrderItem.createMany).not.toHaveBeenCalled();
  });
  it("fingerprint detects price and quantity changes", async () => {
    const original = await purchaseOrderImportPreview(asTx(client()), "po", input);
    const changed = await purchaseOrderImportPreview(asTx(client()), "po", [{ ...input[0], qty: 8 }]);
    expect(changed.fingerprint).not.toBe(original.fingerprint);
    const product = baseProduct(); product.purchasePrices[0].price = 6;
    expect((await purchaseOrderImportPreview(asTx(client(baseOrder(), [product])), "po", input)).fingerprint).not.toBe(original.fingerprint);
  });
  it("applies line writes, totals and incoming stock within one serializable transaction", async () => {
    const tx = client(); mocks.transaction.mockImplementation(async callback => callback(asTx(tx)));
    const preview = await purchaseOrderImportPreview(asTx(tx), "po", input);
    expect(await applyPurchaseOrderImport("po", input, preview.fingerprint)).toBe(1);
    expect(tx.purchaseOrderItem.createMany).toHaveBeenCalledWith({ data: preview.items });
    expect(mocks.totals).toHaveBeenCalledWith("po", tx); expect(mocks.incoming).toHaveBeenCalledWith(tx, ["po"]);
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable", timeout: 60000 });
  });
  it("rejects stale preview before any write", async () => {
    const tx = client(); mocks.transaction.mockImplementation(async callback => callback(asTx(tx)));
    await expect(applyPurchaseOrderImport("po", input, "stale")).rejects.toThrow(/promenili/);
    expect(tx.purchaseOrderItem.createMany).not.toHaveBeenCalled(); expect(mocks.totals).not.toHaveBeenCalled();
  });
  it("propagates totals failure from inside the transaction (no partial commit)", async () => {
    const tx = client(); mocks.transaction.mockImplementation(async callback => callback(asTx(tx)));
    const preview = await purchaseOrderImportPreview(asTx(tx), "po", input); mocks.totals.mockRejectedValue(new Error("calculation failed"));
    await expect(applyPurchaseOrderImport("po", input, preview.fingerprint)).rejects.toThrow("calculation failed");
    expect(mocks.incoming).not.toHaveBeenCalled();
  });
});
