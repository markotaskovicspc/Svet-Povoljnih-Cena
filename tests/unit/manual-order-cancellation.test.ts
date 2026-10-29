import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  courierGuard: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    order: { findUnique: vi.fn(), update: vi.fn() },
    orderStatusEvent: { create: vi.fn() },
    backgroundJob: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: (run: (tx: typeof mocks.tx) => unknown) => run(mocks.tx) } }));
vi.mock("@/lib/order-reservations", () => ({ restoreOrderReservations: mocks.restore }));
vi.mock("@/lib/orders/cancellation-courier.server", () => ({ assertOrderCancellationBeforeCourier: mocks.courierGuard }));
import { cancelManualSalesOrder } from "@/lib/orders/manual-cancellation.server";

const order = {
  id: "order", number: "MP-2026-00004", channel: "MP", status: "SPREMNO_ZA_ISPORUKU",
  cancelledAt: null, stockRestoredAt: null, courierPaidAt: null, sefAcceptedAt: null,
  payments: [{ status: "PENDING" }], paymentRefunds: [], fiscal: null, fiscalDocuments: [],
  invoices: [], sefDocuments: [], dispatchNotes: [], reshipments: [], reclamations: [], supplierFulfillments: [],
  items: ["110081", "210009"].map(sku => ({
    id: `item-${sku}`, productId: `product-${sku}`, sku, qty: 1, warehouseReservedQty: 1,
    warehouseDispatchedQty: 0, supplierReservedQty: 0, dispatchNoteItems: [],
  })),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.order.findUnique.mockResolvedValue(structuredClone(order));
  mocks.tx.backgroundJob.findMany.mockResolvedValue([]);
  mocks.restore.mockResolvedValue({ warehouseLines: 0, supplierCancellationIds: [] });
});

describe("manual order cancellation", () => {
  it.each(["MP", "VP", "INO"])("cancels the entire unpaid %s order and preserves every item", async channel => {
    mocks.tx.order.findUnique.mockResolvedValue({ ...order, channel });
    await expect(cancelManualSalesOrder("order", "actor")).resolves.toMatchObject({ alreadyCancelled: false });
    expect(mocks.restore).toHaveBeenCalledExactlyOnceWith(mocks.tx, expect.objectContaining({
      orderId: "order", actorId: "actor", items: order.items,
    }));
    expect(mocks.tx.order.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "order" }, data: { status: "OTKAZANO", cancelledAt: expect.any(Date), stockRestoredAt: expect.any(Date) },
    });
    expect(mocks.tx.orderStatusEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "actor", status: "OTKAZANO" }) });
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.order.findUnique.mock.invocationCallOrder[0]);
    expect(mocks.courierGuard.mock.invocationCallOrder[0]).toBeLessThan(mocks.restore.mock.invocationCallOrder[0]);
    expect(mocks.tx.$queryRaw.mock.calls[1][0].values).toEqual(["110081", "210009"]);
  });

  it("does not release reservations or add status history a second time", async () => {
    mocks.tx.order.findUnique.mockResolvedValue({ ...order, status: "OTKAZANO", cancelledAt: new Date(), stockRestoredAt: new Date() });
    await expect(cancelManualSalesOrder("order", "actor")).resolves.toMatchObject({ alreadyCancelled: true });
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
    expect(mocks.tx.orderStatusEvent.create).not.toHaveBeenCalled();
  });

  it.each([
    { channel: "WEB" }, { channel: "ANANAS" },
    { status: "U_ISPORUCI" }, { status: "ISPORUCENO" }, { status: "VRACENO" },
    { stockRestoredAt: new Date() }, { cancelledAt: new Date() },
    { payments: [{ status: "AUTHORIZED" }] }, { payments: [{ status: "PAID" }] },
    { payments: [{ status: "REFUNDED" }] }, { paymentRefunds: [{ id: "refund" }] },
    { courierPaidAt: new Date() }, { fiscal: { id: "receipt" } },
    { fiscalDocuments: [{ id: "pending-fiscal" }] }, { invoices: [{ id: "buyer-receipt" }] },
    { sefDocuments: [{ id: "sef" }] }, { sefAcceptedAt: new Date() },
    { dispatchNotes: [{ id: "dispatch" }] }, { reshipments: [{ id: "reship" }] },
    { reclamations: [{ id: "claim" }] }, { supplierFulfillments: [{ id: "supplier" }] },
    { items: [{ ...order.items[0], warehouseDispatchedQty: 1 }] },
    { items: [{ ...order.items[0], dispatchNoteItems: [{ id: "dispatch-item" }] }] },
    { items: [{ ...order.items[0], supplierReservedQty: 1 }] },
  ])("rejects processed orders before stock changes: %j", async patch => {
    mocks.tx.order.findUnique.mockResolvedValue({ ...order, ...patch });
    await expect(cancelManualSalesOrder("order", "actor")).rejects.toThrow();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
    expect(mocks.tx.orderStatusEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a scheduled fiscal operation", async () => {
    mocks.tx.backgroundJob.findMany.mockResolvedValue([{ id: "fiscal-job" }]);
    await expect(cancelManualSalesOrder("order", "actor")).rejects.toThrow("Fiskalizacija");
    expect(mocks.restore).not.toHaveBeenCalled();
  });

  it("keeps an active courier shipment protected", async () => {
    mocks.courierGuard.mockRejectedValue(new Error("Aktivna pošiljka"));
    await expect(cancelManualSalesOrder("order", "actor")).rejects.toThrow("Aktivna pošiljka");
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
  });

  it("does not mark an order cancelled when reservation release fails", async () => {
    mocks.restore.mockRejectedValue(new Error("Stock conflict"));
    await expect(cancelManualSalesOrder("order", "actor")).rejects.toThrow("Stock conflict");
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
    expect(mocks.tx.orderStatusEvent.create).not.toHaveBeenCalled();
  });

  it("rejects missing orders", async () => {
    mocks.tx.order.findUnique.mockResolvedValue(null);
    await expect(cancelManualSalesOrder("missing", "actor")).rejects.toThrow("ne postoji");
    expect(mocks.restore).not.toHaveBeenCalled();
  });
});
