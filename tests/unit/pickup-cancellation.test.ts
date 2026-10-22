import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  availability: vi.fn(), batch: vi.fn(), createShipment: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    pickupBatch: { findUnique: vi.fn(), updateMany: vi.fn() },
    pickupBatchLine: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    order: { findMany: vi.fn(), updateMany: vi.fn() },
    orderStatusEvent: { create: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: {
  $transaction: (run: (tx: typeof mocks.tx) => unknown) => run(mocks.tx),
  pickupBatch: { findUnique: mocks.batch },
} }));
vi.mock("@/lib/admin/pickup-availability.server", () => ({ getPickupPostingAvailability: mocks.availability }));
vi.mock("@/lib/courier", () => ({ createShipmentForOrder: mocks.createShipment }));
vi.mock("@/lib/x-express/shipments", () => ({ createXExpressShipment: mocks.createShipment }));
import { prepareWarehousePickupLabels, removePickupGroupFromBatch } from "@/lib/admin/pickup-batch.server";

const line = { id: "line", orderId: "cancelled", lineGroupKey: "order:cancelled", purpose: "ORDER_DELIVERY", deferredAt: null, reclamation: null };
const batch = { id: "batch", number: "PRE-2026-0090", status: "DRAFT", labelsCreatedAt: null, labelsCreationStartedAt: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.pickupBatch.findUnique.mockResolvedValue(batch);
  mocks.tx.pickupBatchLine.findMany.mockResolvedValue([line]);
  mocks.tx.order.findMany.mockResolvedValue([{ id: "cancelled", number: "SPC-2026-002282", status: "OTKAZANO", paymentMethod: "POUZECE_GOTOVINA", payments: [] }]);
});

it.each(["X_EXPRESS", "MYGLS"])("stops %s before any courier mutation when a cancelled group is still loaded", async provider => {
  // A previous preparation attempt may have started; retries must still check cancellation.
  mocks.batch.mockResolvedValue({ ...batch, provider, labelsCreationStartedAt: new Date(), _count: { lines: 1 }, lines: [line] });
  mocks.availability.mockResolvedValue({ provider, available: true });
  await expect(prepareWarehousePickupLabels("batch", "actor", "a".repeat(64))).rejects.toThrow("Uklonite njenu picking grupu");
  expect(mocks.tx.pickupBatch.updateMany).not.toHaveBeenCalled();
  expect(mocks.createShipment).not.toHaveBeenCalled();
  // The cancellation check must run after the order lock, closing the race with customer/admin cancellation.
  expect(mocks.tx.$queryRaw.mock.calls[1][0].text).toContain('FROM "Order"');
  expect(mocks.tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(mocks.tx.order.findMany.mock.invocationCallOrder[0]);
});

it("allows explicit removal of a cancelled group from an editable picking without reopening the order", async () => {
  mocks.tx.pickupBatchLine.deleteMany.mockResolvedValue({ count: 2 });
  mocks.tx.pickupBatchLine.count.mockResolvedValue(0);
  mocks.tx.order.updateMany.mockResolvedValue({ count: 0 });
  await expect(removePickupGroupFromBatch("batch", line.lineGroupKey, "actor")).resolves.toMatchObject({ removedLineCount: 2 });
  expect(mocks.tx.pickupBatchLine.deleteMany).toHaveBeenCalledWith({ where: { batchId: "batch", lineGroupKey: line.lineGroupKey } });
  expect(mocks.tx.order.updateMany).toHaveBeenCalledWith({ where: { id: "cancelled", status: "U_PRIPREMI" }, data: { status: "KREIRANO" } });
  expect(mocks.tx.orderStatusEvent.create).not.toHaveBeenCalled();
});

it.each([
  { labelsCreationStartedAt: new Date() },
  { labelsCreatedAt: new Date() },
  { status: "BOOKED" },
])("keeps committed picking history protected from manual deletion: %j", async state => {
  mocks.tx.pickupBatch.findUnique.mockResolvedValue({ ...batch, ...state });
  await expect(removePickupGroupFromBatch("batch", line.lineGroupKey, "actor")).rejects.toThrow();
  expect(mocks.tx.pickupBatchLine.deleteMany).not.toHaveBeenCalled();
});
