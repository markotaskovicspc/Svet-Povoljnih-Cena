import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { MyGlsClient } from "@/lib/mygls/client";
import { syncMyGlsShipmentById } from "@/lib/mygls/sync";
import { readPackageHandoverReport } from "@/lib/courier/package-handover";
import { pickupBatchHandoverProgress, pickupCourierSnapshot } from "@/lib/admin/pickup-batch";

const run = `QA-GLS-HANDOVER-${Date.now()}`;
const at = new Date("2026-09-14T09:47:33Z");
const orderIds: string[] = [];
const shipmentIds: string[] = [];
let batchId = "";

afterAll(async () => {
  vi.restoreAllMocks();
  if (batchId) await db.pickupBatch.deleteMany({ where: { id: batchId } });
  await db.auditLog.deleteMany({ where: { entityId: { in: shipmentIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.$disconnect();
});

async function fixture(count: number, base: number, failed = false) {
  const order = await db.order.create({ data: {
    number: `${run}-${base}`, status: "SPREMNO_ZA_ISPORUKU", channel: "WEB", shippingMethod: "KURIR", paymentMethod: "POUZECE_GOTOVINA",
    subtotal: 2000, total: 2000, shipFirstName: "QA", shipLastName: "GLS", shipPhone: "+38160111222",
    shipStreet: "Test 1", shipCity: "Beograd", shipPostalCode: "11000", termsAcceptedAt: at,
    items: { create: Array.from({ length: count }, (_, i) => ({ sku: `${run}-${base}-${i}`, name: `Test ${i}`, qty: 1, unitPriceFull: 1000, unitPriceSale: 1000 })) },
  }, include: { items: true } });
  orderIds.push(order.id);
  const numbers = order.items.map((_, i) => base + i);
  const s = await db.shipment.create({ data: {
    orderId: order.id, service: "COURIER_SMALL", provider: "MYGLS", purpose: "ORDER_DELIVERY", packageCount: count,
    trackingNo: String(base), providerParcelNumbers: numbers, labelObjectKey: "qa-label.pdf",
    status: failed ? "FAILED" : "PICKED_UP", providerStatusCode: failed ? "99" : "86",
    shippedAt: failed ? null : at, lastStatusEventAt: failed ? new Date(at.getTime() + 1000) : at,
    rawCreateResponse: { assignment: { orderItemIds: order.items.map(i => i.id), codAmount: 0 }, untouched: "keep" },
    events: { create: { providerEventId: `MYGLS:${numbers.at(-1)}:86:${at.toISOString()}`, providerStatusCode: "86", status: "PICKED_UP", occurredAt: at } },
  } });
  shipmentIds.push(s.id);
  await db.pickupBatchLine.createMany({ data: order.items.map((item, i) => ({
    batchId, orderId: order.id, orderItemId: item.id, packageNo: i + 1,
    lineGroupKey: `order:${order.id}:MYGLS`, courierPickedUpAt: failed ? null : at,
  })) });
  return { ...s, numbers };
}

describe("GLS production incident regression", () => {
  it("repairs 1/2 handover and false notification failure, and keeps repeat sync idempotent", async () => {
    const batch = await db.pickupBatch.create({ data: { number: `PRE-${run}`, provider: "MYGLS", courier: "COURIER_SMALL", status: "BOOKED" } });
    batchId = batch.id;
    const partial = await fixture(2, 9100000022);
    const failed = await fixture(1, 9100000032, true);
    let allPicked = false;
    const statusList = (pickup: boolean, notification = false) => [
      ...(notification ? [{ StatusCode: "99", StatusDate: new Date(at.getTime() + 1000).toISOString(), StatusDescription: "Notification" }] : []),
      ...(pickup ? [{ StatusCode: "86", StatusDate: at.toISOString(), StatusDescription: "Successful pick up" }] : []),
      { StatusCode: "51", StatusDate: "2026-09-14T04:46:30Z", StatusDescription: "Data sent" },
    ];
    vi.spyOn(MyGlsClient.prototype, "getParcelListStatuses").mockImplementation(async () => ({
      ParcelList: [...partial.numbers].reverse().map(n => ({ ParcelNumber: n, ParcelStatusList: statusList(allPicked || n === partial.numbers[1]) })),
    }));
    vi.spyOn(MyGlsClient.prototype, "getParcelStatuses").mockImplementation(async () => ({ ParcelNumber: failed.numbers[0], ParcelStatusList: statusList(true, true) }));

    for (let i = 0; i < 2; i++) {
      await syncMyGlsShipmentById(partial.id, { notify: false });
      await syncMyGlsShipmentById(failed.id, { notify: false });
      const shipment = await db.shipment.findUniqueOrThrow({ where: { id: partial.id } });
      const report = readPackageHandoverReport(shipment.rawCreateResponse);
      expect(report).toMatchObject({ pickedUpPackages: 1, expectedPackages: 2, source: "MYGLS" });
      expect(shipment.rawCreateResponse).toMatchObject({ untouched: "keep" });
      const rows = await db.pickupBatchLine.findMany({ where: { batchId }, orderBy: { packageNo: "asc" } });
      expect(rows.filter(l => l.orderId === partial.orderId).every(l => l.courierPickedUpAt === null)).toBe(true);
      expect(rows.find(l => l.orderId === failed.orderId)?.courierPickedUpAt).not.toBeNull();
      const displayed = rows.map(l => ({ ...l, handoverReport: l.orderId === partial.orderId ? report : null }));
      expect(pickupBatchHandoverProgress(displayed)).toMatchObject({ totalPackages: 3, pickedUpPackages: 2, pickedUpGroups: 1 });
      expect(pickupCourierSnapshot({ provider: "MYGLS", purpose: "ORDER_DELIVERY", reclamationId: null, orderItemId: null,
        courierPickedUpAt: at, shipments: [shipment] })).toMatchObject({ label: "Delimično preuzeto (1/2)", pickedUpAt: null });
      expect(await db.shipment.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ status: "PICKED_UP", providerStatusCode: "86", shippedAt: at });
    }
    expect(await db.auditLog.count({ where: { entityId: partial.id, action: "shipment.mygls-package-handover.sync" } })).toBe(1);
    expect(await db.shipmentEvent.count({ where: { shipmentId: failed.id, providerEventId: { endsWith: ":status-map-v2" } } })).toBe(1);
    allPicked = true;
    await syncMyGlsShipmentById(partial.id, { notify: false });
    expect(await db.pickupBatchLine.count({ where: { batchId, courierPickedUpAt: { not: null } } })).toBe(3);
    expect(await db.pickupBatch.findUniqueOrThrow({ where: { id: batchId } })).toMatchObject({ status: "PICKED_UP" });
  });
});
