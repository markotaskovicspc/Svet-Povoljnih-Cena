import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, availability } = vi.hoisted(() => ({ availability: vi.fn(), tx: {
  $queryRaw: vi.fn(),
  pickupBatch: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  pickupBatchLine: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  orderReshipment: { updateMany: vi.fn() },
  warehouse: { findFirst: vi.fn() },
  orderStatusEvent: { create: vi.fn() },
} }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (run: (t: typeof tx) => unknown) => run(tx) } }));
vi.mock("@/lib/admin/pickup-availability.server", () => ({ getPickupPostingAvailability: availability }));
import { createPickupBatch, deferPickupPackageBeforeBooking, loadEligibleOrders } from "@/lib/admin/pickup-batch.server";
const batch = { id: "shared", number: "PRE-shared", provider: "X_EXPRESS", status: "DRAFT", labelsCreationStartedAt: null, labelsCreatedAt: null };
beforeEach(() => {
  vi.resetAllMocks();
  tx.$queryRaw.mockResolvedValue([]);
  tx.pickupBatch.findUnique.mockResolvedValue(batch);
  tx.pickupBatch.findMany.mockResolvedValue([]);
  tx.warehouse.findFirst.mockResolvedValue({ id: "dc" });
  availability.mockResolvedValue({ provider: "X_EXPRESS", reason: null });
});

describe("shared picking work", () => {
  it("opening a picking reuses the draft containing already queued work", async () => {
    tx.pickupBatch.findFirst.mockResolvedValue(batch);
    expect(await createPickupBatch("X_EXPRESS")).toEqual(batch);
    expect(tx.pickupBatch.create).not.toHaveBeenCalled();
    expect(tx.pickupBatch.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      provider: "X_EXPRESS", status: "DRAFT", labelsCreationStartedAt: null, labelsCreatedAt: null,
    } }));
  });

  it("collects existing unsent replacements and reshipments even when there are no new orders", async () => {
    tx.pickupBatch.findMany.mockResolvedValue([{ ...batch, id: "old-special" }]);
    await loadEligibleOrders("shared", "admin");
    expect(tx.pickupBatchLine.updateMany).toHaveBeenCalledWith({
      where: { batchId: "old-special", OR: [
        { purpose: "RECLAMATION_REPLACEMENT" }, { lineGroupKey: { startsWith: "reshipment:" } }, { deferredFromLineId: { not: null } },
      ] }, data: { batchId: "shared" },
    });
    expect(tx.orderReshipment.updateMany).toHaveBeenCalledWith({ where: { batchId: "old-special" }, data: { batchId: "shared" } });
    expect(tx.pickupBatch.findMany.mock.calls[0][0].where).toMatchObject({
      provider: "X_EXPRESS", status: "DRAFT", labelsCreationStartedAt: null, labelsCreatedAt: null,
      lines: { none: { shipmentId: { not: null } } },
    });
  });

  it("does not collect unrelated work during an explicitly scoped recovery", async () => {
    await loadEligibleOrders("shared", "admin", []);
    expect(tx.pickupBatchLine.updateMany).not.toHaveBeenCalled();
    expect(tx.orderReshipment.updateMany).not.toHaveBeenCalled();
  });

  it("does not move a source draft whose label generation started concurrently", async () => {
    tx.pickupBatch.findMany.mockResolvedValue([{ ...batch, id: "old-special" }]);
    tx.pickupBatch.findUnique.mockResolvedValueOnce(batch).mockResolvedValueOnce({ ...batch, labelsCreationStartedAt: new Date() });
    await expect(loadEligibleOrders("shared", "admin")).rejects.toThrow();
    expect(tx.pickupBatchLine.updateMany).not.toHaveBeenCalled();
  });
});

it("deferring a two-unit carton removes the value of both units from COD", async () => {
  tx.pickupBatchLine.findFirst.mockResolvedValue({ id: "parcel", batch, purpose: "ORDER_DELIVERY", packedQuantity: 2,
    lineGroupKey: "order:1", orderId: "o", packageNo: 1, order: { status: "U_PRIPREMI" },
    orderItem: { unitPriceSale: 1250, withAssembly: false, assemblyPrice: null },
  });
  await deferPickupPackageBeforeBooking("shared", "parcel", "admin");
  const saved = tx.pickupBatchLine.update.mock.calls[0][0].data;
  expect(Number(saved.packageValue)).toBe(2500);
  expect(saved.warehouseReadyAt).toBeNull();
});
