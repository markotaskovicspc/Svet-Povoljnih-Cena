import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  xExpress: vi.fn(),
  myGls: vi.fn(),
  email: vi.fn(),
}));
vi.mock("@/lib/x-express/shipments", async (original) => ({
  ...await original<typeof import("@/lib/x-express/shipments")>(),
  createXExpressShipmentForOrder: mocks.xExpress,
}));
vi.mock("@/lib/mygls", async (original) => ({
  ...await original<typeof import("@/lib/mygls")>(),
  createMyGlsShipmentForOrder: mocks.myGls,
}));
vi.mock("@/lib/email", async (original) => ({
  ...await original<typeof import("@/lib/email")>(),
  trackedDispatch: mocks.email,
}));
vi.mock("@/lib/rabalux/documents", async (original) => ({
  ...await original<typeof import("@/lib/rabalux/documents")>(),
  buildRabaluxShipmentAttachments: async () => [
    { filename: "adresnica-test.html", content: "", contentType: "text/html" },
    { filename: "pak-lista-test.pdf", content: "", contentType: "application/pdf" },
  ],
}));

import { db } from "@/lib/db";
import { enqueueBackgroundJob, processBackgroundJob } from "@/lib/background-jobs";
import { createShipmentForOrder } from "@/lib/courier/registry";
import { loadEligibleOrders, pickupAssignmentCodAmount } from "@/lib/admin/pickup-batch.server";
import { rabaluxCourierAvailableAt } from "@/lib/rabalux/dispatch-policy";

const prefix = `RAB-DISPATCH-${Date.now()}`;
let orderId = "";
let fulfillmentId = "";
let supplierItemId = "";
let dcItemId = "";
let batchId = "";
let warehouseId = "";
let supplierId = "";
let actorId = "";
const productIds: string[] = [];

beforeAll(async () => {
  Object.assign(process.env, {
    RABALUX_ENABLED: "true",
    COURIER_SMALL_PROVIDER: "MYGLS",
    RABALUX_PICKUP_NAME: "Rabalux Srbija",
    RABALUX_PICKUP_STREET: "Donje Sajlovo",
    RABALUX_PICKUP_HOUSE_NUMBER: "108",
    RABALUX_PICKUP_CITY: "Novi Sad",
    RABALUX_PICKUP_POSTAL_CODE: "21000",
    RABALUX_PICKUP_CONTACT_NAME: "Rabalux magacin",
    RABALUX_PICKUP_CONTACT_PHONE: "0658151898",
    RABALUX_PICKUP_CONTACT_EMAIL: "infosrb@rabalux.com",
    RABALUX_X_EXPRESS_TOWN_ID: "802824",
    RABALUX_X_EXPRESS_LATITUDE: "45.2728814",
    RABALUX_X_EXPRESS_LONGITUDE: "19.7837926",
  });
  mocks.xExpress.mockResolvedValue({
    id: "mock-supplier-shipment", provider: "X_EXPRESS", status: "CREATED",
    providerShipmentId: "mock-request-guid", trackingNo: "QA123",
  });
  mocks.myGls.mockResolvedValue({ id: "mock-dc-shipment", provider: "MYGLS", status: "CREATED" });
  mocks.email.mockResolvedValue({ ok: true, id: "mock-email", provider: "none" });
  const actor = await db.adminUser.create({ data: {
    email: `${prefix}@example.invalid`, passwordHash: "not-used", role: "OPS",
  } });
  actorId = actor.id;
  const warehouse = await db.warehouse.create({ data: {
    code: prefix, name: prefix, isDefault: true, active: true,
  } });
  warehouseId = warehouse.id;
  const supplier = await db.supplier.upsert({
    where: { integrationKey: "RABALUX" },
    create: { name: prefix, integrationKey: "RABALUX", email: "infosrb@rabalux.com" },
    update: { enabled: true, email: "infosrb@rabalux.com" },
  });
  supplierId = supplier.id;
  for (const [suffix, side] of [["RAB", 88], ["DC", 77]] as const) {
    const product = await db.product.create({ data: {
      sku: `${prefix}-${suffix}`, slug: `${prefix}-${suffix}`.toLowerCase(), name: suffix,
      fullPrice: 1000, description: "Isolated test", grossWeightKg: 15,
      unitPackWidthCm: 20, unitPackDepthCm: 57, unitPackHeightCm: side,
    } });
    productIds.push(product.id);
  }
  const order = await db.order.create({ data: {
    number: prefix, status: "KREIRANO", channel: "WEB", total: 3554, subtotal: 4181,
    shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA",
    shipFirstName: "Test", shipLastName: "Buyer", shipPhone: "0601234567",
    shipStreet: "Test 1", shipCity: "Novi Sad", shipPostalCode: "21000",
    termsAcceptedAt: new Date(),
    items: { create: [
      { productId: productIds[0], sku: `${prefix}-RAB`, name: "Shaun2", qty: 1,
        unitPriceFull: 182, unitPriceSale: 182, supplierReservedQty: 1,
        supplierIntegrationKey: "RABALUX", supplierExternalSku: "71232" },
      { productId: productIds[1], sku: `${prefix}-DC`, name: "FLEX SEAT", qty: 1,
        unitPriceFull: 3999, unitPriceSale: 3999, warehouseReservedQty: 1, warehouseId },
    ] },
  }, include: { items: true } });
  orderId = order.id;
  supplierItemId = order.items.find((item) => item.supplierReservedQty > 0)!.id;
  dcItemId = order.items.find((item) => item.warehouseReservedQty > 0)!.id;
  const fulfillment = await db.supplierFulfillment.create({ data: {
    orderId, supplierId, status: "SENT", sentAt: new Date(),
    items: { create: { orderItemId: supplierItemId, productId: productIds[0], externalSku: "71232", qty: 1 } },
  } });
  fulfillmentId = fulfillment.id;
  const batch = await db.pickupBatch.create({ data: {
    number: prefix, provider: "MYGLS", courier: "COURIER_SMALL",
  } });
  batchId = batch.id;
});

afterAll(async () => {
  await db.backgroundJob.deleteMany({ where: { idempotencyKey: { startsWith: prefix } } });
  if (batchId) await db.pickupBatch.delete({ where: { id: batchId } });
  if (orderId) await db.order.delete({ where: { id: orderId } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  if (warehouseId) await db.warehouse.delete({ where: { id: warehouseId } });
  if (actorId) await db.adminUser.delete({ where: { id: actorId } });
});

describe.sequential("Rabalux and DC dispatch", () => {
  it("loads the DC chair even when the COD order has an unready Rabalux shipment", async () => {
    await db.supplierFulfillment.update({ where: { id: fulfillmentId }, data: { status: "PENDING" } });
    const loaded = await loadEligibleOrders(batchId, actorId);
    expect(loaded.orderCount).toBe(1);
    const lines = await db.pickupBatchLine.findMany({ where: { batchId } });
    expect(lines).toHaveLength(1);
    expect(lines[0].orderItemId).toBe(dcItemId);
    expect(Number(lines[0].heightCm)).toBe(77);
    expect(await pickupAssignmentCodAmount(orderId, "MYGLS", [dcItemId])).toBe(3554);
    await createShipmentForOrder(orderId, { orderItemIds: [dcItemId], codAmount: 3554 });
    expect(mocks.myGls).toHaveBeenCalledWith(orderId, expect.objectContaining({ codAmount: 3554 }));
    expect(mocks.xExpress).not.toHaveBeenCalled();
  });

  it("schedules every enqueue and defers old jobs without spending retry attempts", async () => {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const due = rabaluxCourierAvailableAt(order.createdAt);
    const job = await enqueueBackgroundJob({
      kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL", payload: { fulfillmentId },
      idempotencyKey: `${prefix}:scheduled`,
    });
    expect((await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).availableAt).toEqual(due);
    expect(await processBackgroundJob(job.id)).toMatchObject({ claimed: false });
    // Simulate a queued job produced by the previous release.
    await db.backgroundJob.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
    expect(await processBackgroundJob(job.id)).toMatchObject({ claimed: true, deferred: true });
    expect(await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "QUEUED", attempts: 0, availableAt: due, lastError: null,
    });
    expect(mocks.xExpress).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });

  it("sends only Rabalux through X Express the next day with warehouse pickup and zero COD", async () => {
    await db.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - 2 * 86400000) } });
    const job = await enqueueBackgroundJob({
      kind: "SUPPLIER_SHIPPING_DOCUMENTS_EMAIL", payload: { fulfillmentId },
      idempotencyKey: `${prefix}:due`,
    });
    expect(await processBackgroundJob(job.id)).toMatchObject({ claimed: true, ok: true });
    expect(mocks.xExpress).toHaveBeenCalledWith(orderId, expect.objectContaining({
      orderItemIds: [supplierItemId], supplierFulfillmentId: fulfillmentId,
      packageCount: 1, codAmount: 0,
      pickupOverride: expect.objectContaining({
        townId: 802824, streetName: "Donje Sajlovo", streetNumber: "108",
        contactPhone: "0658151898", contactEmail: "infosrb@rabalux.com",
      }),
    }));
    expect(mocks.email).toHaveBeenCalledTimes(1);
    expect(await processBackgroundJob(job.id)).toMatchObject({ claimed: false });
    expect(mocks.xExpress).toHaveBeenCalledTimes(1);
  });
});
