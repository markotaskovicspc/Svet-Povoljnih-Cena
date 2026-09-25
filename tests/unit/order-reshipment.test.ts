import { beforeEach, describe, expect, it, vi } from "vitest";
const { tx, adjust } = vi.hoisted(() => ({ adjust: vi.fn(), tx: {
  $queryRaw: vi.fn(), shipment: { findUnique: vi.fn() }, order: { update: vi.fn() },
  pickupBatch: { findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
  pickupBatchLine: { findMany: vi.fn(), createMany: vi.fn() },
  orderReshipment: { create: vi.fn() }, orderReshipmentItem: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  stockMovement: { findFirst: vi.fn(), findUnique: vi.fn() },
  product: { findUniqueOrThrow: vi.fn() }, warehouse: { findUnique: vi.fn() },
  orderStatusEvent: { create: vi.fn() },
} }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } }));
vi.mock("@/lib/inventory", () => ({ adjustInventory: adjust }));
vi.mock("@/lib/fiscal/return-lock", () => ({ lockOrderReturn: vi.fn() }));
import { queueOrderReshipment, receiveReshipmentReturn } from "@/lib/admin/order-reshipment.server";

const input = { orderId: "o", shipmentId: "s", actorId: "admin", reason: "Kurir ne može da pronađe robu" };
const source = () => ({ id: "s", orderId: "o", purpose: "ORDER_DELIVERY", provider: "X_EXPRESS", status: "IN_TRANSIT", reshipment: null, trackingNo: "OLD", codAmount: null,
  rawCreateResponse: { assignment: { orderItemIds: ["i"], codAmount: 4500 } },
  order: { id: "o", number: "WEB-1", status: "U_ISPORUCI", cancelledAt: null, stockRestoredAt: null, paymentMethod: "POUZECE_GOTOVINA", total: 4500, payments: [], paymentRefunds: [],
    items: [{ id: "i", productId: "p", warehouseId: "w", sku: "SKU", name: "Artikal", qty: 2, supplierReservedQty: 0 }] },
});
beforeEach(() => {
  vi.resetAllMocks();
  tx.shipment.findUnique.mockResolvedValue(source());
  tx.pickupBatchLine.findMany.mockResolvedValue([1, 2].map(packageNo => ({ orderItemId: "i", quantity: 2, packageNo, weightKg: 4, widthCm: 30, heightCm: 30, depthCm: 30 })));
  tx.pickupBatch.findMany.mockResolvedValue([]);
  tx.pickupBatch.create.mockResolvedValue({ id: "b", number: "PRE-2026-0001" });
  tx.orderReshipment.create.mockResolvedValue({ id: "r" });
  tx.stockMovement.findFirst.mockResolvedValue(null);
  tx.stockMovement.findUnique.mockResolvedValue(null);
  tx.product.findUniqueOrThrow.mockResolvedValue({ sku: "SKU", stock: 10, warehouseStocks: [{ warehouseId: "w", qty: 10 }], orderItems: [], partnerReservations: [] });
  tx.warehouse.findUnique.mockResolvedValue({ active: true, isDefault: true });
});
describe("new goods for an unresolved courier delivery", () => {
  it("queues new goods and the old shipment return after X Express incomplete delivery", async () => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), status: "FAILED", providerStatusCode: "DLV_FAIL_INCOMPLETE" });
    expect(await queueOrderReshipment(input)).toMatchObject({ id: "b" });
    expect(adjust.mock.calls[0][1]).toMatchObject({ qtyDelta: -2 });
    expect(tx.orderReshipment.create.mock.calls[0][0].data.sourceShipmentId).toBe("s");
  });
  it.each(["PCK_FAIL_INCOMPLETE", "LOCAL_ANNOUNCEMENT_FAILED", "DELETED", "UNKNOWN"])("does not treat %s as a failed delivery", async providerStatusCode => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), status: "FAILED", providerStatusCode });
    await expect(queueOrderReshipment(input)).rejects.toThrow("Ponovno slanje");
    expect(tx.pickupBatch.create).not.toHaveBeenCalled();
    expect(adjust).not.toHaveBeenCalled();
  });
  it("creates distinct picking packages, debits new goods once per item and keeps the original fiscal ledger untouched", async () => {
    expect(await queueOrderReshipment(input)).toMatchObject({ id: "b" });
    expect(adjust).toHaveBeenCalledTimes(1);
    const debit = adjust.mock.calls[0][1];
    expect(debit).toMatchObject({ qtyDelta: -2, warehouseId: "w", idempotencyKey: "reshipment-out:r:i", kind: "ADJUSTMENT" });
    expect(debit).not.toHaveProperty("orderItemId");
    expect(tx.pickupBatchLine.createMany.mock.calls[0][0].data).toEqual([1, 2].map(packageNo => expect.objectContaining({ lineGroupKey: "reshipment:r", quantity: 2, packageNo })));
    expect(tx.orderReshipment.create.mock.calls[0][0].data).toMatchObject({ sourceShipmentId: "s", codAmount: 4500 });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "o" }, data: { status: "U_PRIPREMI" } });
  });
  it("puts a reshipment in the shared unstarted courier batch", async () => {
    tx.pickupBatch.findFirst.mockResolvedValue({ id: "shared", number: "PRE-shared" });
    tx.pickupBatch.findUniqueOrThrow.mockResolvedValue({ id: "shared", status: "DRAFT", labelsCreationStartedAt: null, labelsCreatedAt: null });
    tx.pickupBatchLine.findMany.mockResolvedValue([{ orderItemId: "i", quantity: 2, packedQuantity: 2, packageNo: 1 }]);
    expect(await queueOrderReshipment(input)).toMatchObject({ id: "shared" });
    expect(tx.pickupBatch.create).not.toHaveBeenCalled();
    expect(tx.orderReshipment.create.mock.calls[0][0].data).toMatchObject({ batchId: "shared", codAmount: 4500 });
    expect(tx.pickupBatchLine.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ batchId: "shared", packedQuantity: 2, quantity: 2 }),
    ]);
    expect(adjust.mock.calls[0][1]).toMatchObject({ qtyDelta: -2 });
  });

  it("returns the existing picking batch on a repeated request without debiting again", async () => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), reshipment: { batch: { id: "existing" } } });
    expect(await queueOrderReshipment(input)).toEqual({ id: "existing" });
    expect(adjust).not.toHaveBeenCalled();
    expect(tx.orderReshipment.create).not.toHaveBeenCalled();
  });
  it.each(["DELIVERED", "CREATED", "FAILED"])("rejects %s before writing", async status => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), status });
    await expect(queueOrderReshipment(input)).rejects.toThrow("Ponovno slanje");
    expect(tx.pickupBatch.create).not.toHaveBeenCalled();
  });
  it("does not allocate stock reserved for other buyers", async () => {
    tx.product.findUniqueOrThrow.mockResolvedValue({ sku: "SKU", stock: 10, warehouseStocks: [{ warehouseId: "w", qty: 10 }], orderItems: [{ warehouseId: "w", warehouseReservedQty: 9, stockMovements: [] }], partnerReservations: [] });
    await expect(queueOrderReshipment(input)).rejects.toThrow("Nema dovoljno");
    expect(adjust).not.toHaveBeenCalled();
    expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();
  });
  it("does not refund or charge COD again for a paid bank transfer", async () => {
    const s = source();
    tx.shipment.findUnique.mockResolvedValue({ ...s, order: { ...s.order, paymentMethod: "UPLATA_NA_RACUN", payments: [{ status: "PAID" }] } });
    await queueOrderReshipment(input);
    expect(tx.orderReshipment.create.mock.calls[0][0].data.codAmount).toBe(0);
  });
  it("rejects a mismatched order and an already received/refunded return", async () => {
    await expect(queueOrderReshipment({ ...input, orderId: "different" })).rejects.toThrow("nije pronađena");
    tx.stockMovement.findFirst.mockResolvedValue({ id: "return" });
    await expect(queueOrderReshipment(input)).rejects.toThrow("knjižen povrat");
    expect(adjust).not.toHaveBeenCalled();
  });
  it("does not collect COD again when payment is already recorded", async () => {
    const s = source();
    tx.shipment.findUnique.mockResolvedValue({ ...s, order: { ...s.order, payments: [{ status: "PAID" }] } });
    await queueOrderReshipment(input);
    expect(tx.orderReshipment.create.mock.calls[0][0].data.codAmount).toBe(0);
  });
});
describe("physical return of the old goods", () => {
  beforeEach(() => tx.orderReshipmentItem.findUniqueOrThrow.mockResolvedValue({ id: "ri", quantity: 2, receivedQty: 0, productId: "p", sku: "SKU", reshipment: { orderId: "o", order: { number: "WEB-1", status: "U_PRIPREMI" }, sourceShipment: { trackingNo: "OLD" } } }));
  const receipt = { itemId: "ri", unitNo: 1, warehouseId: "w", actorId: "admin" };
  it("receives one inspected unit without a fiscal return or changing the active order", async () => {
    await receiveReshipmentReturn(receipt);
    expect(adjust.mock.calls[0][1]).toMatchObject({ qtyDelta: 1, kind: "ADJUSTMENT", idempotencyKey: "reshipment-return:ri:1" });
    expect(adjust.mock.calls[0][1]).not.toHaveProperty("orderItemId");
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(tx.orderReshipmentItem.update).toHaveBeenCalledTimes(1);
  });
  it("does not receive the same unit twice", async () => {
    tx.stockMovement.findUnique.mockResolvedValue({ id: "existing" });
    await receiveReshipmentReturn(receipt);
    expect(adjust).not.toHaveBeenCalled();
    expect(tx.orderReshipmentItem.update).not.toHaveBeenCalled();
  });
  it("requires an explicit receiving warehouse", async () => {
    await expect(receiveReshipmentReturn({ ...receipt, warehouseId: "" })).rejects.toThrow("magacin");
    expect(adjust).not.toHaveBeenCalled();
  });
  it.each([0, 2, 3, 1.5])("rejects invalid or out-of-sequence unit %s", async unitNo => {
    await expect(receiveReshipmentReturn({ ...receipt, unitNo })).rejects.toThrow();
    expect(adjust).not.toHaveBeenCalled();
  });
});
