import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claim: vi.fn(), receiveAllowed: vi.fn(), inventory: vi.fn(), update: vi.fn(), queue: vi.fn(), fiscal: vi.fn(), insideTx: false }));
const tx = {
  $queryRaw: vi.fn(), reclamation: { findUnique: mocks.claim, update: mocks.update },
  warehouse: { findFirst: vi.fn() }, stockMovement: { findUnique: vi.fn(), findMany: vi.fn() }, warehouseStock: { findFirst: vi.fn() },
};
vi.mock("@/lib/db", () => ({ db: { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => {
  mocks.insideTx = true;
  try { return await callback(tx); } finally { mocks.insideTx = false; }
}) } }));
vi.mock("@/lib/admin/reclamation-refund-notice.server", () => ({ queueReclamationRefundNotice: mocks.queue, queueReclamationFiscalRefund: mocks.fiscal }));
vi.mock("@/lib/mygls/return-booking", () => ({ assertMyGlsReturnAccepted: vi.fn(), canReceiveReclamationShipment: mocks.receiveAllowed }));
vi.mock("@/lib/fiscal/return-lock", () => ({ lockOrderReturn: vi.fn() }));
vi.mock("@/lib/fiscal/return-stock", () => ({ returnedStockBalance: vi.fn(async () => ({ refunded: 0 })) }));
vi.mock("@/lib/admin/return-resolution.server", () => ({ assertReturnNotLost: vi.fn() }));
vi.mock("@/lib/inventory", () => ({ adjustInventory: mocks.inventory, ensureDefaultWarehouse: vi.fn() }));
vi.mock("@/lib/courier/registry", () => ({ createShipmentForOrder: vi.fn(), preflightShipmentForOrder: vi.fn() }));
vi.mock("@/lib/x-express/shipments", () => ({ announceXExpressShipment: vi.fn() }));
vi.mock("@/lib/mygls/shipments", () => ({ deleteMyGlsLabelsForShipment: vi.fn(), ensureMyGlsReturnDocument: vi.fn() }));
import { receiveReclamationReturn } from "@/lib/admin/reclamation-fulfillment.server";

describe("return intake notification transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claim.mockResolvedValue({ id: "claim-1", number: "R-1", orderId: "order-1", orderItemId: "item-1", productId: "product-1", sku: "110177", quantity: 2, status: "PRIMLJENO", shipments: [{ status: "DELIVERED" }] });
    mocks.receiveAllowed.mockReturnValue(true);
    tx.warehouse.findFirst.mockResolvedValue({ id: "warehouse-1", code: "DC", name: "DC", active: true });
    tx.stockMovement.findUnique.mockResolvedValue(null);
    tx.stockMovement.findMany.mockResolvedValue([]);
    tx.warehouseStock.findFirst.mockResolvedValue({ id: "stock-1" });
    mocks.inventory.mockResolvedValue({ id: "movement-1", qty: 2 });
    mocks.update.mockResolvedValue({ id: "claim-1" });
    mocks.fiscal.mockImplementation(async () => { expect(mocks.insideTx).toBe(true); expect(mocks.inventory).toHaveBeenCalled(); return "fiscal-job"; });
    mocks.queue.mockImplementation(async () => {
      expect(mocks.insideTx).toBe(true);
      expect(mocks.inventory).toHaveBeenCalled();
      expect(mocks.update).toHaveBeenCalled();
      return "job-1";
    });
  });
  it("commits the receipt and durable mail task in the same transaction", async () => {
    expect(await receiveReclamationReturn({ reclamationId: "claim-1", warehouseId: "warehouse-1", actorId: "admin-1" }))
      .toMatchObject({ movement: { id: "movement-1" }, refundNoticeJobId: "job-1", refundJobId: "fiscal-job" });
    expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(tx, "claim-1");
  });
  it("does not queue a notice when the courier has not delivered the return", async () => {
    mocks.receiveAllowed.mockReturnValue(false);
    await expect(receiveReclamationReturn({ reclamationId: "claim-1", warehouseId: "warehouse-1", actorId: "admin-1" })).rejects.toThrow("fizički dolazak");
    expect(mocks.queue).not.toHaveBeenCalled();
    expect(mocks.inventory).not.toHaveBeenCalled();
  });
});
