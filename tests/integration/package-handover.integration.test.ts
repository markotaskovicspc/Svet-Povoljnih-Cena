import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordPackageHandover } from "@/lib/admin/package-handover.server";
import { applyShipmentEvent } from "@/lib/courier/registry";
import { readPackageHandoverReport } from "@/lib/courier/package-handover";

const run = `handover-${Date.now()}-${process.pid}`;
const at = new Date("2026-09-07T15:19:19.148Z");
let orderId = "";
let shipmentId = "";
let batchId = "";
let trackingNo = "";

beforeAll(async () => {
  process.env.COURIER_SMALL_PROVIDER = "X_EXPRESS";
  const order = await db.order.create({ data: {
    number: run, status: "SPREMNO_ZA_ISPORUKU", channel: "WEB", shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA",
    subtotal: 2000, total: 2000, shipFirstName: "QA", shipLastName: "Handover", shipPhone: "+38160111222",
    shipStreet: "Test 1", shipCity: "Beograd", shipPostalCode: "11000", termsAcceptedAt: at,
    items: { create: ["chair", "blender"].map(name => ({ sku: `${run}-${name}`, name, qty: 1, unitPriceFull: 1000, unitPriceSale: 1000 })) },
  }, include: { items: true } });
  orderId = order.id;
  const batch = await db.pickupBatch.create({ data: { number: `PRE-${run}`, provider: "X_EXPRESS", courier: "COURIER_SMALL", status: "PICKED_UP",
    lines: { create: order.items.map((item, index) => ({ orderId, orderItemId: item.id, lineGroupKey: `order:${orderId}:X_EXPRESS`, packageNo: index + 1, courierPickedUpAt: at })) },
  } });
  batchId = batch.id;
  trackingNo = `QA-${run}`;
  const shipment = await db.shipment.create({ data: { orderId, provider: "X_EXPRESS", service: "COURIER_SMALL", purpose: "ORDER_DELIVERY",
    status: "PICKED_UP", packageCount: 2, trackingNo, shippedAt: at, lastStatusEventAt: at,
    rawCreateResponse: { assignment: { orderItemIds: order.items.map(item => item.id), codAmount: 0 }, untouched: "preserve-me" },
    events: { create: { status: "PICKED_UP", providerEventId: run, occurredAt: at } },
  } });
  shipmentId = shipment.id;
});

afterAll(async () => {
  if (batchId) await db.pickupBatch.deleteMany({ where: { id: batchId } });
  if (orderId) await db.order.deleteMany({ where: { id: orderId } });
  if (shipmentId) await db.auditLog.deleteMany({ where: { entity: "Shipment", entityId: shipmentId } });
  await db.$disconnect();
});

describe("partial handover persistence and courier replay", () => {
  it("records 1/2, corrects automatic markers and keeps it through duplicate and later courier events", async () => {
    const input = { orderId, shipmentId, pickedUpPackages: 1, note: "Preuzet jedan paket; identitet paketa nije poznat.", actorId: null };
    const report = await recordPackageHandover(input);
    expect(report).toMatchObject({ pickedUpPackages: 1, expectedPackages: 2, source: "USER_REPORT" });
    await expect(recordPackageHandover(input)).resolves.toEqual(report);
    await expect(db.auditLog.count({ where: { entityId: shipmentId, action: "shipment.package-handover.record" } })).resolves.toBe(1);
    const cleared = await db.pickupBatch.findUniqueOrThrow({ where: { id: batchId }, include: { lines: true } });
    expect(cleared.status).toBe("BOOKED");
    expect(cleared.lines.map(line => line.courierPickedUpAt)).toEqual([null, null]);
    const duplicate = await applyShipmentEvent("COURIER_SMALL", { trackingNo, status: "PICKED_UP", providerEventId: run, occurredAt: at });
    expect(duplicate).toMatchObject({ eventCreated: false, stateApplied: false });
    const later = await applyShipmentEvent("COURIER_SMALL", { trackingNo, status: "DELIVERED", providerEventId: `${run}-later`, occurredAt: new Date(at.getTime() + 86400000) });
    expect(later).toMatchObject({ eventCreated: true, orderStatus: "U_ISPORUCI" });
    await expect(db.pickupBatchLine.count({ where: { batchId, courierPickedUpAt: { not: null } } })).resolves.toBe(0);
    const stored = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
    expect(readPackageHandoverReport(stored.rawCreateResponse)).toEqual(report);
    expect(stored.rawCreateResponse).toMatchObject({ untouched: "preserve-me" });
    await expect(db.orderStatusEvent.count({ where: { orderId, note: { startsWith: "Delimično preuzeto (1/2)" } } })).resolves.toBe(1);
    await expect(recordPackageHandover({ ...input, pickedUpPackages: 3 })).rejects.toThrow("veća");
    await expect(recordPackageHandover({ ...input, orderId: "wrong-order" })).rejects.toThrow("nije pronađen");
    await recordPackageHandover({ ...input, pickedUpPackages: 2, note: "Potvrđeno preuzimanje preostalog paketa." });
    await expect(db.pickupBatchLine.count({ where: { batchId, courierPickedUpAt: { not: null } } })).resolves.toBe(2);
    await expect(db.pickupBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } })).resolves.toEqual({ status: "PICKED_UP" });
  });
});
