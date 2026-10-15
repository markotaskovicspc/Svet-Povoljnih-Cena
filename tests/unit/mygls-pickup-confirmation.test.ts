import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  globalOrders: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    pickupBatch: { findUnique: vi.fn(), update: vi.fn() },
    order: { findMany: vi.fn() },
    shipment: { findMany: vi.fn() },
    orderStatusEvent: { createMany: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: (run: (tx: typeof mocks.tx) => unknown) => run(mocks.tx),
  order: { findMany: mocks.globalOrders },
} }));
import { confirmMyGlsPickupAnnouncement } from "@/lib/admin/pickup-batch.server";
const booking = { channel: "MYGLS_API" as const, reference: "batch-79" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.globalOrders.mockRejectedValue(new Error("timeout exceeded when trying to connect"));
  mocks.tx.pickupBatch.findUnique.mockResolvedValue({
    id: "b", number: "PRE-2026-0079", provider: "MYGLS", status: "DRAFT", labelsCreatedAt: new Date(),
    lines: [{ orderId: "o", lineGroupKey: "order:o", purpose: "ORDER_DELIVERY", orderItemId: "item", packedItems: null, deferredAt: null }],
  });
  mocks.tx.order.findMany.mockResolvedValue([{ id: "o", number: "SPC-1", status: "U_PRIPREMI", paymentMethod: "POUZECE_GOTOVINA", payments: [] }]);
  mocks.tx.shipment.findMany.mockResolvedValue([{ orderId: "o", purpose: "ORDER_DELIVERY", rawCreateResponse: { assignment: { orderItemIds: ["item"], codAmount: 100 } } }]);
});
it("finalizes existing labels using the held transaction connection, without asking the single-connection pool for another", async () => {
  await expect(confirmMyGlsPickupAnnouncement("b", "actor", booking)).resolves.toMatchObject({ orderCount: 1 });
  expect(mocks.globalOrders).not.toHaveBeenCalled();
  expect(mocks.tx.order.findMany).toHaveBeenCalledOnce();
  expect(mocks.tx.pickupBatch.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "BOOKED", configurationIssue: null }) }));
});
it("still rejects unpaid orders without marking the batch as booked", async () => {
  mocks.tx.order.findMany.mockResolvedValue([{ id: "o", number: "SPC-1", status: "U_PRIPREMI", paymentMethod: "UPLATA_NA_RACUN", payments: [] }]);
  await expect(confirmMyGlsPickupAnnouncement("b", "actor", booking)).rejects.toThrow();
  expect(mocks.tx.pickupBatch.update).not.toHaveBeenCalled();
});
it("retains exact shipment-assignment validation during recovery", async () => {
  mocks.tx.shipment.findMany.mockResolvedValue([]);
  await expect(confirmMyGlsPickupAnnouncement("b", "actor", booking)).rejects.toThrow("Nedostaje uspešna");
  expect(mocks.tx.pickupBatch.update).not.toHaveBeenCalled();
});
it("does not duplicate finalization when the same booking was already recorded", async () => {
  const batch = await mocks.tx.pickupBatch.findUnique();
  mocks.tx.pickupBatch.findUnique.mockResolvedValue({ ...batch, status: "BOOKED", externalBookedAt: new Date(), externalBookingChannel: booking.channel, externalBookingReference: booking.reference });
  await expect(confirmMyGlsPickupAnnouncement("b", "actor", booking)).resolves.toMatchObject({ orderCount: 1 });
  expect(mocks.tx.order.findMany).not.toHaveBeenCalled();
  expect(mocks.tx.orderStatusEvent.createMany).not.toHaveBeenCalled();
});
