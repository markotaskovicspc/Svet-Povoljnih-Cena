import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { tx, adjust } = vi.hoisted(() => ({ adjust: vi.fn(), tx: {
  returnResolution: { findUnique: vi.fn() },
  $queryRaw: vi.fn(), shipment: { findUnique: vi.fn() }, order: { update: vi.fn() },
  pickupBatch: { findMany: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn() },
  pickupBatchLine: { findMany: vi.fn(), createMany: vi.fn() },
  orderReshipment: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() }, orderReshipmentItem: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  stockMovement: { findFirst: vi.fn(), findUnique: vi.fn() },
  product: { findUniqueOrThrow: vi.fn() }, warehouse: { findUnique: vi.fn() },
  orderStatusEvent: { create: vi.fn() },
} }));
vi.mock("@/lib/db", () => ({ db: { $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } }));
vi.mock("@/lib/inventory", () => ({ adjustInventory: adjust }));
vi.mock("@/lib/fiscal/return-lock", () => ({ lockOrderReturn: vi.fn() }));
import { queueOrderReshipment, receiveReshipmentReturn, loadPendingOrderReshipments } from "@/lib/admin/order-reshipment.server";

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
  tx.orderReshipment.create.mockResolvedValue({ id: "r", batchId: null, batch: null });
  tx.orderReshipment.findMany.mockResolvedValue([]);
  tx.orderReshipment.updateMany.mockResolvedValue({ count: 1 });
  tx.stockMovement.findFirst.mockResolvedValue(null);
  tx.stockMovement.findUnique.mockResolvedValue(null);
  tx.product.findUniqueOrThrow.mockResolvedValue({ sku: "SKU", stock: 10, warehouseStocks: [{ warehouseId: "w", qty: 10 }], orderItems: [], partnerReservations: [] });
  tx.warehouse.findUnique.mockResolvedValue({ active: true, isDefault: true });
});
describe("new goods for an unresolved courier delivery", () => {
  it.each([
    { status: "CREATED", providerStatusCode: "CREATED" },
    { status: "FAILED", providerStatusCode: "DELETED" },
  ])("requires explicit confirmation when an accepted X Express shipment has no pickup scan: %j", async state => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), ...state, providerShipmentId: "accepted-request" });
    await expect(queueOrderReshipment(input)).rejects.toThrow("Potvrdite da je X Express preuzeo robu");
    expect(tx.orderReshipment.create).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(adjust).not.toHaveBeenCalled();
  });

  it.each([
    { status: "CREATED", providerStatusCode: "CREATED" },
    { status: "FAILED", providerStatusCode: "DELETED" },
  ])("returns an unscanned legacy shipment to picking without rewriting courier evidence or debiting twice: %j", async state => {
    const s = source();
    const unscanned = { ...s, ...state, providerShipmentId: "accepted-request", order: { ...s.order, status: "KREIRANO" } };
    tx.shipment.findUnique.mockResolvedValue(unscanned);
    // Old picking records, including SPC-2026-000779, have no direct shipmentId.
    tx.pickupBatchLine.findMany.mockResolvedValue([{ orderItemId: "i", shipmentId: null, quantity: 2, packedQuantity: 2, packageNo: 1 }]);
    const confirmed = { ...input, confirmUnscannedPickup: true };
    expect(await queueOrderReshipment(confirmed)).toMatchObject({ id: "r", batchId: null });
    expect(tx.orderStatusEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: "admin", status: "U_PRIPREMI", note: expect.stringContaining("Operater je potvrdio da je X Express preuzeo robu bez evidentiranog preuzimanja"),
    }) });
    expect(tx.orderReshipment.create.mock.calls[0][0].data).toMatchObject({ sourceShipmentId: "s", reason: input.reason, actorId: "admin", codAmount: 4500 });
    expect(tx.pickupBatchLine.findMany.mock.calls[0][0].where).toMatchObject({ lineGroupKey: "order:o:X_EXPRESS", batch: { provider: "X_EXPRESS", status: { in: ["BOOKED", "PICKED_UP"] } } });
    expect(unscanned.status).toBe(state.status);
    expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();

    tx.shipment.findUnique.mockResolvedValue({ ...unscanned, reshipment: { id: "r", batchId: null } });
    await queueOrderReshipment(confirmed);
    expect(tx.orderReshipment.create).toHaveBeenCalledTimes(1);
    expect(adjust).toHaveBeenCalledTimes(1);

    tx.orderReshipment.findMany.mockResolvedValue([{ id: "r", orderId: "o", sourceShipment: unscanned, order: unscanned.order, items: [{ orderItemId: "i", quantity: 2 }] }]);
    expect(await loadPendingOrderReshipments(tx as unknown as Prisma.TransactionClient, { id: "selected", number: "PRE-selected" }, "X_EXPRESS", "admin"))
      .toEqual({ reshipmentCount: 1, reshipmentLineCount: 1 });
    expect(tx.pickupBatchLine.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ batchId: "selected", lineGroupKey: "reshipment:r", quantity: 2 })]);
    expect(adjust).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "CREATED", providerShipmentId: null },
    { status: "FAILED", providerStatusCode: "DELETED", providerShipmentId: null },
    { status: "FAILED", providerStatusCode: "DELETED", providerShipmentId: "accepted", trackingNo: null },
    { status: "FAILED", providerStatusCode: "PCK_FAIL_INCOMPLETE", providerShipmentId: "accepted" },
    { status: "CREATED", providerShipmentId: " " },
    { status: "CREATED", providerShipmentId: "accepted", trackingNo: " " },
    { status: "CREATED", providerShipmentId: "accepted", provider: "MYGLS" },
    { status: "FAILED", providerShipmentId: "accepted", providerStatusCode: "LOCAL_ANNOUNCEMENT_FAILED" },
    { status: "DELIVERED", providerShipmentId: "accepted" },
  ])("manual confirmation cannot bypass an ineligible shipment: %j", async fields => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), ...fields });
    await expect(queueOrderReshipment({ ...input, confirmUnscannedPickup: true })).rejects.toThrow("Ponovno slanje");
    expect(tx.orderReshipment.create).not.toHaveBeenCalled();
    expect(adjust).not.toHaveBeenCalled();
  });

  it.each([
    { status: "OTKAZANO" },
    { status: "ISPORUCENO" },
    { cancelledAt: new Date() },
    { stockRestoredAt: new Date() },
    { paymentRefunds: [{ id: "refund" }] },
  ])("manual confirmation retains order safeguards: %j", async fields => {
    const s = source();
    tx.shipment.findUnique.mockResolvedValue({ ...s, status: "CREATED", providerShipmentId: "accepted", order: { ...s.order, ...fields } });
    await expect(queueOrderReshipment({ ...input, confirmUnscannedPickup: true })).rejects.toThrow("ne može ponovo");
    expect(tx.orderReshipment.create).not.toHaveBeenCalled();
    expect(adjust).not.toHaveBeenCalled();
  });

  it("requires the original booked picking evidence even for confirmed unscanned pickup", async () => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), status: "CREATED", providerShipmentId: "accepted" });
    tx.pickupBatchLine.findMany.mockResolvedValue([]);
    await expect(queueOrderReshipment({ ...input, confirmUnscannedPickup: true })).rejects.toThrow("picking evidenciju");
    expect(tx.orderReshipment.create).not.toHaveBeenCalled();
    expect(adjust).not.toHaveBeenCalled();
  });

  it("queues new goods and the old shipment return after X Express incomplete delivery", async () => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), status: "FAILED", providerStatusCode: "DLV_FAIL_INCOMPLETE" });
    expect(await queueOrderReshipment(input)).toMatchObject({ id: "r", batchId: null });
    expect(adjust.mock.calls[0][1]).toMatchObject({ qtyDelta: -2 });
    expect(tx.orderReshipment.create.mock.calls[0][0].data.sourceShipmentId).toBe("s");
  });
  it.each(["PCK_FAIL_INCOMPLETE", "LOCAL_ANNOUNCEMENT_FAILED", "DELETED", "UNKNOWN"])("does not treat %s as a failed delivery", async providerStatusCode => {
    tx.shipment.findUnique.mockResolvedValue({ ...source(), status: "FAILED", providerStatusCode });
    await expect(queueOrderReshipment(input)).rejects.toThrow("Ponovno slanje");
    expect(tx.pickupBatch.create).not.toHaveBeenCalled();
    expect(adjust).not.toHaveBeenCalled();
  });
  it("queues without creating or filling a picking batch, reserves goods once and preserves the fiscal ledger", async () => {
    expect(await queueOrderReshipment(input)).toMatchObject({ id: "r", batchId: null });
    expect(adjust).toHaveBeenCalledTimes(1);
    const debit = adjust.mock.calls[0][1];
    expect(debit).toMatchObject({ qtyDelta: -2, warehouseId: "w", idempotencyKey: "reshipment-out:r:i", kind: "ADJUSTMENT" });
    expect(debit).not.toHaveProperty("orderItemId");
    expect(tx.pickupBatch.create).not.toHaveBeenCalled();
    expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();
    expect(tx.orderReshipment.create.mock.calls[0][0].data).not.toHaveProperty("batchId");
    expect(tx.orderReshipment.create.mock.calls[0][0].data).toMatchObject({ sourceShipmentId: "s", codAmount: 4500 });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "o" }, data: { status: "U_PRIPREMI" } });
  });
  it("leaves an existing courier draft untouched until explicit loading", async () => {
    tx.pickupBatch.findFirst.mockResolvedValue({ id: "shared", number: "PRE-shared" });
    expect(await queueOrderReshipment(input)).toMatchObject({ id: "r", batchId: null });
    expect(tx.pickupBatch.findFirst).not.toHaveBeenCalled();
    expect(tx.pickupBatch.create).not.toHaveBeenCalled();
    expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();
  });

  it.each([null, { id: "existing", number: "PRE-existing" }])("returns an existing reshipment without debiting again (batch %s)", async batch => {
    const retry = { id: "r", batchId: batch?.id ?? null, batch };
    tx.shipment.findUnique.mockResolvedValue({ ...source(), reshipment: retry });
    expect(await queueOrderReshipment(input)).toEqual(retry);
    expect(adjust).not.toHaveBeenCalled();
    expect(tx.orderReshipment.create).not.toHaveBeenCalled();
    expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();
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
  beforeEach(() => tx.orderReshipmentItem.findUniqueOrThrow.mockResolvedValue({ id: "ri", reshipmentId: "r", quantity: 2, receivedQty: 0, productId: "p", sku: "SKU", reshipment: { orderId: "o", order: { number: "WEB-1", status: "U_PRIPREMI" }, sourceShipment: { trackingNo: "OLD" } } }));
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
  it("blocks stock receipt after a lost closure", async () => {
    tx.returnResolution.findUnique.mockResolvedValue({ key: "reshipment:r" });
    await expect(receiveReshipmentReturn(receipt)).rejects.toThrow("izgubljen");
    expect(adjust).not.toHaveBeenCalled();
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

it("resends a consolidated parcel as one package and reserves every contained SKU", async () => {
  const s = source();
  s.order.items.push({ ...s.order.items[0], id: "j", productId: "p2", sku: "SKU2", qty: 3 });
  s.rawCreateResponse.assignment.orderItemIds.push("j");
  tx.shipment.findUnique.mockResolvedValue(s);
  const packedItems = ["i", "j"].map((orderItemId, i) => ({ orderItemId, quantity: 2 + i, sku: `SKU${i}`, name: "POMPEA", barcode: null, categoryName: null, color1: null, color2: null, unitValue: 100 }));
  tx.pickupBatchLine.findMany.mockResolvedValue([{ orderItemId: "i", quantity: 5, packedQuantity: 5, packedItems, packageNo: 1 }]);
  await queueOrderReshipment(input);
  expect(adjust.mock.calls.map(call => call[1])).toEqual([
    expect.objectContaining({ productId: "p", qtyDelta: -2 }),
    expect.objectContaining({ productId: "p2", qtyDelta: -3 }),
  ]);
  expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();
  expect(tx.orderReshipment.create.mock.calls[0][0].data.items.create).toEqual([
    expect.objectContaining({ orderItemId: "i", quantity: 2 }),
    expect.objectContaining({ orderItemId: "j", quantity: 3 }),
  ]);
});


describe("explicit loading of pending reshipments", () => {
  const batch = { id: "selected", number: "PRE-selected" };
  const load = (provider: "X_EXPRESS" | "MYGLS" = "X_EXPRESS") => loadPendingOrderReshipments(tx as unknown as Prisma.TransactionClient, batch, provider, "admin");
  const pending = () => ({ id: "r", orderId: "o", sourceShipment: source(), order: source().order, items: [{ orderItemId: "i", quantity: 2 }] });
  beforeEach(() => tx.orderReshipment.findMany.mockResolvedValue([pending()]));

  it.each(["X_EXPRESS", "MYGLS"] as const)("loads only pending %s work into the selected batch without another stock debit", async provider => {
    expect(await load(provider)).toEqual({ reshipmentCount: 1, reshipmentLineCount: 2 });
    expect(tx.orderReshipment.findMany.mock.calls[0][0].where).toEqual({ batchId: null, sourceShipment: { provider } });
    expect(tx.orderReshipment.updateMany).toHaveBeenCalledWith({ where: { id: "r", batchId: null }, data: { batchId: "selected" } });
    expect(tx.pickupBatchLine.createMany.mock.calls[0][0].data).toEqual([1, 2].map(packageNo => expect.objectContaining({ batchId: "selected", lineGroupKey: "reshipment:r", quantity: 2, packageNo })));
    expect(adjust).not.toHaveBeenCalled();
    expect(tx.pickupBatch.create).not.toHaveBeenCalled();
  });

  it("does not load an already claimed reshipment a second time", async () => {
    tx.orderReshipment.updateMany.mockResolvedValue({ count: 0 });
    expect(await load()).toEqual({ reshipmentCount: 0, reshipmentLineCount: 0 });
    expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();
  });

  it("keeps consolidated parcel contents and quantities", async () => {
    const packedItems = ["i", "j"].map((orderItemId, i) => ({ orderItemId, quantity: 2 + i }));
    tx.pickupBatchLine.findMany.mockResolvedValue([{ orderItemId: "i", packedQuantity: 5, packedItems, packageNo: 1 }]);
    tx.orderReshipment.findMany.mockResolvedValue([{ ...pending(), items: [{ orderItemId: "i", quantity: 2 }, { orderItemId: "j", quantity: 3 }] }]);
    expect(await load()).toEqual({ reshipmentCount: 1, reshipmentLineCount: 1 });
    expect(tx.pickupBatchLine.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ packedItems, quantity: 5, packedQuantity: 5, packageNo: 1 })]);
  });

  it("rejects missing source packages before claiming the pending work", async () => {
    tx.pickupBatchLine.findMany.mockResolvedValue([]);
    await expect(load()).rejects.toThrow("picking evidenciju");
    expect(tx.orderReshipment.updateMany).not.toHaveBeenCalled();
    expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();
  });

  it("preserves payment readiness and skips cancelled orders", async () => {
    const retry = pending();
    tx.orderReshipment.findMany.mockResolvedValue([{ ...retry, order: { ...retry.order, paymentMethod: "UPLATA_NA_RACUN" } }]);
    await expect(load()).rejects.toThrow();
    expect(tx.pickupBatchLine.createMany).not.toHaveBeenCalled();
    tx.orderReshipment.findMany.mockResolvedValue([{ ...retry, order: { ...retry.order, status: "OTKAZANO" } }]);
    expect(await load()).toEqual({ reshipmentCount: 0, reshipmentLineCount: 0 });
  });
});
