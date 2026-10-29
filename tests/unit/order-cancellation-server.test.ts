import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  restore: vi.fn(), queue: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    order: { findUnique: vi.fn(), update: vi.fn() },
    pickupBatchLine: { findMany: vi.fn(), deleteMany: vi.fn() },
    shipment: { findMany: vi.fn() },
    backgroundJob: { findMany: vi.fn(), updateMany: vi.fn() },
    orderStatusEvent: { create: vi.fn() },
    warehouse: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/db", () => ({ db: { $transaction: (run: (tx: typeof mocks.tx) => unknown) => run(mocks.tx) } }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: mocks.queue }));
vi.mock("@/lib/order-reservations", () => ({ restoreOrderReservations: mocks.restore }));

import { cancelWebOrderByCustomer } from "@/lib/orders/cancellation.server";
import { assertOrderCancellationBeforeCourier } from "@/lib/orders/cancellation-courier.server";

const order = {
  id: "order", number: "SPC-2026-002282", channel: "WEB", status: "U_PRIPREMI",
  reshipments: [], fiscal: null, fiscalDocuments: [], sefDocuments: [], payments: [], shipments: [],
  items: [{ id: "item", warehouse: { email: "warehouse@example.invalid" } }],
  pickupBatchLines: [{ id: "line", batch: { id: "batch", number: "PRE-2026-0090", status: "DRAFT", labelsCreationStartedAt: null, labelsCreatedAt: null } }],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.order.findUnique.mockResolvedValue(structuredClone(order));
  mocks.tx.pickupBatchLine.findMany.mockResolvedValue([]);
  mocks.tx.shipment.findMany.mockResolvedValue([]);
  mocks.tx.backgroundJob.findMany.mockResolvedValue([]);
  mocks.restore.mockResolvedValue({ warehouseLines: 1, supplierCancellationIds: [] });
});

describe("cancellation preserves the loaded picking", () => {
  it("cancels before labels, releases reservations, and leaves every picking line intact", async () => {
    const result = await cancelWebOrderByCustomer({ orderId: "order" });
    expect(result).toMatchObject({ removedPickupLines: 0, pickupBatchNumbers: ["PRE-2026-0090"] });
    expect(mocks.tx.pickupBatchLine.deleteMany).not.toHaveBeenCalled();
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "OTKAZANO" }) }));
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ kind: "ORDER_CANCELLATION_WAREHOUSE_EMAIL", payload: expect.objectContaining({ removedPickupLines: 0 }) }), mocks.tx);
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.pickupBatchLine.findMany.mock.invocationCallOrder[0]);
  });

  it.each(["web", "email", "facebook"] as const)("rejects %s cancellation once label preparation owns the batch", async (channel) => {
    mocks.tx.pickupBatchLine.findMany.mockResolvedValue([{ batch: { status: "POSTING" } }]);
    await expect(cancelWebOrderByCustomer({ orderId: "order", requestedViaSocial: channel })).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
    expect(mocks.tx.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("protects an existing courier shipment outside a picking batch", async () => {
    mocks.tx.order.findUnique.mockResolvedValue({ ...order, pickupBatchLines: [] });
    mocks.tx.shipment.findMany.mockResolvedValue([{ id: "shipment", status: "CREATED" }]);
    await expect(cancelWebOrderByCustomer({ orderId: "order" })).rejects.toThrow("Porudžbina nije otkazana");
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.tx.order.update).not.toHaveBeenCalled();
  });

  it("uses the same courier guard for administrator cancellation", async () => {
    mocks.tx.shipment.findMany.mockResolvedValue([{ id: "shipment", status: "CREATED" }]);
    await expect(assertOrderCancellationBeforeCourier(mocks.tx as never, "order")).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("keeps repeated cancellation idempotent without deleting history or notifying again", async () => {
    mocks.tx.order.findUnique.mockResolvedValue({ ...order, status: "OTKAZANO" });
    await expect(cancelWebOrderByCustomer({ orderId: "order" })).resolves.toMatchObject({ alreadyCancelled: true, removedPickupLines: 0 });
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.tx.pickupBatchLine.deleteMany).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
