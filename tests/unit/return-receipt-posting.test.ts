import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  transaction: vi.fn(), query: vi.fn(), order: vi.fn(), warehouse: vi.fn(),
  find: vi.fn(), movements: vi.fn(), create: vi.fn(), fiscal: vi.fn(), adjust: vi.fn(), enqueue: vi.fn(), updateJob: vi.fn(), findJob: vi.fn(),
}));
const tx = {
  $queryRaw: m.query, order: { findFirst: m.order }, warehouse: { findFirst: m.warehouse },
  stockMovement: { findUnique: m.find, findMany: m.movements, create: m.create },
  fiscalDocumentLine: { aggregate: m.fiscal }, backgroundJob: { updateMany: m.updateJob, findUnique: m.findJob },
};
vi.mock("@/lib/db", () => ({ db: { $transaction: m.transaction } }));
vi.mock("@/lib/inventory", () => ({ adjustInventory: m.adjust }));
vi.mock("@/lib/background-jobs", () => ({ enqueueBackgroundJob: m.enqueue }));
import { receiveReturnedOrderUnit } from "@/lib/admin/returned-orders.server";

const input = { orderId: "order", orderItemId: "item", unitNo: 1, warehouseId: "warehouse", actorId: "admin" };
beforeEach(() => {
  vi.clearAllMocks();
  m.transaction.mockImplementation(run => run(tx));
  m.query.mockResolvedValue([{ locked: true }]);
  m.order.mockResolvedValue({ number: "SPC-1", items: [{ id: "item", productId: "product", sku: "sku", qty: 3 }] });
  m.warehouse.mockResolvedValue({ id: "warehouse", code: "MAG-004", name: "Povrati" });
  m.find.mockResolvedValue(null);
  m.findJob.mockResolvedValue(null);
  m.movements.mockResolvedValue([]);
  m.fiscal.mockResolvedValue({ _sum: { refundedQty: 0 } });
  m.adjust.mockResolvedValue({ id: "receipt", qty: 1 });
  m.create.mockResolvedValue({ id: "receipt", qty: 0 });
  m.enqueue.mockResolvedValue({ id: "job", status: "QUEUED" });
});

describe("physical returned package receipt", () => {
  it("does not mutate stock while another refund holds the order lock", async () => {
    m.query.mockResolvedValue([{ locked: false }]);
    await expect(receiveReturnedOrderUnit(input)).rejects.toThrow("već obrađuje");
    expect(m.adjust).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("posts one unit and queues the refund in the same transaction", async () => {
    expect(await receiveReturnedOrderUnit(input)).toMatchObject({ jobId: "job" });
    expect(m.adjust).toHaveBeenCalledWith(tx, expect.objectContaining({ qtyDelta: 1 }));
    expect(m.enqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "RETURN_FISCAL_REFUND", idempotencyKey: "return-fiscal:receipt" }), tx);
  });
  it("does not post stock again when the same receipt is retried with buyer identity", async () => {
    m.find.mockResolvedValue({ id: "receipt", qty: 1 });
    m.findJob.mockResolvedValue({ id: "job", status: "FAILED", payload: { movementId: "receipt" } });
    await receiveReturnedOrderUnit({ ...input, buyerId: "20:TEST" });
    expect(m.adjust).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
    expect(m.updateJob).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ buyerId: "20:TEST" }) }) }));
  });
  it("records a physical receipt without a second stock increase after a manual fiscal refund", async () => {
    m.movements.mockResolvedValue([{ qty: 1, idempotencyKey: "fiscal-refund:doc:line", warehouseId: "warehouse" }]);
    m.fiscal.mockResolvedValue({ _sum: { refundedQty: 1 } });
    await receiveReturnedOrderUnit(input);
    expect(m.adjust).not.toHaveBeenCalled();
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ qty: 0, idempotencyKey: "order-return:SPC-1:item:1" }) }));
  });
  it("posts the next unit after an earlier received and refunded unit", async () => {
    m.movements.mockResolvedValue([{ qty: 1, idempotencyKey: "order-return:SPC-1:item:1", warehouseId: "warehouse" }]);
    m.fiscal.mockResolvedValue({ _sum: { refundedQty: 1 } });
    await receiveReturnedOrderUnit({ ...input, unitNo: 2 });
    expect(m.adjust).toHaveBeenCalledWith(tx, expect.objectContaining({ qtyDelta: 1 }));
  });
  it("does not silently receive previously posted stock into a different warehouse", async () => {
    m.movements.mockResolvedValue([{ qty: 1, idempotencyKey: "fiscal-refund:doc:line", warehouseId: "other" }]);
    m.fiscal.mockResolvedValue({ _sum: { refundedQty: 1 } });
    await expect(receiveReturnedOrderUnit(input)).rejects.toThrow("drugog magacina");
    expect(m.adjust).not.toHaveBeenCalled();
  });
});
