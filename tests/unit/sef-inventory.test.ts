import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), transaction: vi.fn(), adjust: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { sefDocument: { findUniqueOrThrow: mocks.find }, $transaction: mocks.transaction } }));
vi.mock("@/lib/inventory", () => ({ adjustInventory: mocks.adjust }));
vi.mock("@/lib/channel-availability.server", () => ({ syncProductChannelAvailability: mocks.sync }));
import { ensureSefInventoryPosted } from "@/lib/sef/inventory.server";
const line = { id: "item1", productId: "p1", sku: "SKU1", qty: 2, warehouseId: "w1", warehouseReservedQty: 2, supplierReservedQty: 0 };
const doc = { id: "sef1", number: "SEF/1", direction: "OUT", environment: "production", sentAt: new Date(), orderId: "order1", inventoryPostedAt: null, inventorySnapshot: [line] };
function tx(posted = false, changed = false, movements: { qty: number }[] = []) {
  return { $queryRaw: vi.fn(), sefDocument: { findUniqueOrThrow: vi.fn(async () => ({ ...doc, inventoryPostedAt: posted ? new Date() : null })), update: vi.fn() }, orderItem: { findMany: vi.fn(async () => [{ ...line, qty: changed ? 3 : 2, stockMovements: movements }]), update: vi.fn() } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.find.mockResolvedValue(doc); });
describe("SEF inventory recovery without another financial write", () => {
  it("posts warehouse stock once and releases reservation in the same transaction", async () => {
    const database = tx(); mocks.transaction.mockImplementation(fn => fn(database));
    await ensureSefInventoryPosted("sef1");
    expect(mocks.adjust).toHaveBeenCalledWith(database, expect.objectContaining({ idempotencyKey: "sef-sale:sef1:item1", qtyDelta: -2 }));
    expect(database.orderItem.update).toHaveBeenCalledWith({ where: { id: "item1" }, data: { warehouseReservedQty: 0, supplierReservedQty: 0 } });
    expect(database.sefDocument.update).toHaveBeenCalledWith({ where: { id: "sef1" }, data: { inventoryPostedAt: expect.any(Date) } });
  });
  it("rechecks the commit marker after locking, preventing concurrent double posting", async () => {
    mocks.transaction.mockImplementation(fn => fn(tx(true)));
    await ensureSefInventoryPosted("sef1"); expect(mocks.adjust).not.toHaveBeenCalled();
  });
  it("does not debit legacy reservations again", async () => {
    mocks.transaction.mockImplementation(fn => fn(tx(false, false, [{ qty: -2 }])));
    await ensureSefInventoryPosted("sef1"); expect(mocks.adjust).not.toHaveBeenCalled();
  });
  it("blocks changed quantities before touching stock", async () => {
    mocks.transaction.mockImplementation(fn => fn(tx(false, true)));
    await expect(ensureSefInventoryPosted("sef1")).rejects.toThrow("rezervacija je promenjena"); expect(mocks.adjust).not.toHaveBeenCalled();
  });
  it("never posts demo invoices or unconfirmed submissions", async () => {
    mocks.find.mockResolvedValueOnce({ ...doc, environment: "demo" }).mockResolvedValueOnce({ ...doc, sentAt: null });
    await ensureSefInventoryPosted("sef1"); await ensureSefInventoryPosted("sef1"); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
