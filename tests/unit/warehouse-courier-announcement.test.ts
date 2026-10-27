import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), announce: vi.fn(), create: vi.fn(), shipments: vi.fn(),
  order: vi.fn(), deferred: vi.fn(), events: vi.fn(), lock: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const db = {
    pickupBatch: { findUnique: mocks.find, updateMany: mocks.update },
    pickupBatchLine: { findMany: mocks.deferred },
    shipment: { findMany: mocks.shipments }, order: { findMany: mocks.order },
    orderStatusEvent: { createMany: mocks.events }, $queryRaw: mocks.lock,
  };
  return { db: { ...db, $transaction: async (run: (tx: typeof db) => unknown) => run(db) } };
});
vi.mock("@/lib/admin/pickup-availability.server", () => ({ getPickupPostingAvailability: async () => ({ available: true, provider: "X_EXPRESS" }) }));
vi.mock("@/lib/courier", () => ({ createShipmentForOrder: mocks.create }));
vi.mock("@/lib/x-express/shipments", () => ({ announceXExpressShipment: mocks.announce }));
import { prepareWarehousePickupLabels } from "@/lib/admin/pickup-batch.server";

const line = (id: string) => ({ id, orderId: id, orderItemId: `item-${id}`, lineGroupKey: `order:${id}`, purpose: "ORDER_DELIVERY", reclamationId: null,
  deferredAt: null, packedItems: null, packedQuantity: 1, packageNo: 1, weightKg: 1, widthCm: 10, depthCm: 10, heightCm: 10 });
let batch: { id: string; number: string; provider: string; status: string; labelsCreatedAt: Date; labelsCreationStartedAt: Date; lines: ReturnType<typeof line>[] };
beforeEach(() => {
  vi.resetAllMocks();
  batch = { id: "batch", number: "PRE-1", provider: "X_EXPRESS", status: "DRAFT", labelsCreatedAt: new Date(), labelsCreationStartedAt: new Date(), lines: [line("one"), line("two")] };
  mocks.find.mockImplementation(async (args) => args.select?._count ? { ...batch, _count: { lines: batch.lines.length }, lines: [] } : { ...batch });
  mocks.update.mockImplementation(async ({ where, data }) => {
    if (where.status !== batch.status) return { count: 0 };
    // The first POSTING query is only stale-lock recovery, not a new claim.
    if (where.updatedAt) return { count: 0 };
    Object.assign(batch, data); return { count: 1 };
  });
  mocks.order.mockImplementation(async () => batch.lines.map(l => ({ id: l.orderId, number: l.orderId, status: "U_PRIPREMI", paymentMethod: "POUZECE_GOTOVINA", payments: [] })));
  mocks.shipments.mockResolvedValue(batch.lines.map(l => ({ id: `shipment-${l.orderId}`, orderId: l.orderId, purpose: "ORDER_DELIVERY", packageCount: 1, rawCreateResponse: null })));
  mocks.announce.mockImplementation(async id => ({ id, providerShipmentId: `provider-${id}`, status: "CREATED" }));
  mocks.deferred.mockResolvedValue([]);
});

it("warehouse completion sends prepared parcels to X Express and books the batch without an admin action", async () => {
  await expect(prepareWarehousePickupLabels("batch", "warehouse", "a".repeat(64))).resolves.toMatchObject({ announced: 1, shipmentCount: 2 });
  expect(mocks.announce.mock.calls.map(c => c[0])).toEqual(["shipment-one", "shipment-two"]);
  expect(batch.status).toBe("BOOKED");
  expect(mocks.create).not.toHaveBeenCalled();
  await prepareWarehousePickupLabels("batch", "warehouse", "a".repeat(64));
  expect(mocks.announce).toHaveBeenCalledTimes(2);
});

it("propagates a partial-send failure, retains prepared labels and resumes those same shipments", async () => {
  mocks.announce.mockResolvedValueOnce({ providerShipmentId: "accepted-one", status: "CREATED" }).mockRejectedValueOnce(new Error("Courier unavailable"));
  await expect(prepareWarehousePickupLabels("batch", "warehouse", "a".repeat(64))).rejects.toThrow("Courier unavailable");
  expect(batch.status).toBe("DRAFT");
  expect(batch).toHaveProperty("configurationIssue", expect.stringContaining("1 od 2"));
  expect(batch.labelsCreatedAt).toBeInstanceOf(Date);
  await expect(prepareWarehousePickupLabels("batch", "warehouse", "a".repeat(64))).resolves.toMatchObject({ shipmentCount: 2 });
  expect(batch.status).toBe("BOOKED");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.announce.mock.calls.map(c => c[0])).toEqual(["shipment-one", "shipment-two", "shipment-one", "shipment-two"]);
});
