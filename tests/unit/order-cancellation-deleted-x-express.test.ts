import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertOrderCancellationBeforeCourier } from "@/lib/orders/cancellation-courier.server";

const labelsAt = new Date("2026-09-16T09:37:09.670Z");
const deletedAt = new Date("2026-10-02T01:00:02.301Z");
const deleted = {
  id: "shipment", provider: "X_EXPRESS", providerShipmentId: "provider-id",
  status: "FAILED", providerStatusCode: "DELETED",
  createdAt: new Date("2026-09-16T09:37:02.715Z"),
  lastStatusSyncAt: new Date("2026-10-02T01:00:10.777Z"), lastStatusEventAt: deletedAt,
  shippedAt: null, deliveredAt: null,
  events: [
    { status: "CREATED", providerStatusCode: "CREATED", occurredAt: labelsAt },
    { status: "FAILED", providerStatusCode: "DELETED", occurredAt: deletedAt },
  ],
};
const legacyLine = {
  shipmentId: null, providerParcelId: null, providerLabelCancelledAt: null,
  courierPickedUpAt: null, deferredAt: null, orderItem: { warehouseDispatchedQty: 0 },
  batch: { provider: "X_EXPRESS", status: "BOOKED", labelsCreationStartedAt: labelsAt, labelsCreatedAt: labelsAt },
};
const tx = {
  pickupBatchLine: { findMany: vi.fn() },
  shipment: { findMany: vi.fn() },
  orderItem: { findFirst: vi.fn() },
};
const check = () => assertOrderCancellationBeforeCourier(tx as never, "order", { allowConfirmedDeleted: true });
beforeEach(() => {
  vi.resetAllMocks();
  tx.pickupBatchLine.findMany.mockResolvedValue([structuredClone(legacyLine)]);
  tx.shipment.findMany.mockResolvedValue([structuredClone(deleted)]);
  tx.orderItem.findFirst.mockResolvedValue(null);
});

describe("confirmed deleted X Express labels", () => {
  it("preserves the stricter customer cancellation policy", async () => {
    await expect(assertOrderCancellationBeforeCourier(tx as never, "order")).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });
  it("allows the historical BOOKED picking without deleting or changing history", async () => {
    await expect(check()).resolves.toBeUndefined();
  });

  it("also allows an explicitly linked deleted label", async () => {
    tx.pickupBatchLine.findMany.mockResolvedValue([{ ...legacyLine, shipmentId: "shipment" }]);
    await expect(check()).resolves.toBeUndefined();
  });

  it("allows a deleted shipment outside picking", async () => {
    tx.pickupBatchLine.findMany.mockResolvedValue([]);
    await expect(check()).resolves.toBeUndefined();
  });

  it("rejects dispatched stock even when no picking line remains", async () => {
    tx.pickupBatchLine.findMany.mockResolvedValue([]);
    tx.orderItem.findFirst.mockResolvedValue({ id: "dispatched-item" });
    await expect(check()).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it.each(["CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED"])(
    "keeps %s shipments protected", async status => {
      tx.shipment.findMany.mockResolvedValue([{ ...deleted, status }]);
      await expect(check()).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    },
  );

  it.each(["UNKNOWN", "LOST", "DAMAGED", "CONFISCATED", "PCK_FAIL_CANCELED", "SRVC_CANCELED", null])(
    "does not treat FAILED/%s as confirmed deletion", async providerStatusCode => {
      tx.shipment.findMany.mockResolvedValue([{ ...deleted, providerStatusCode }]);
      await expect(check()).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    },
  );

  it.each([
    { events: [] },
    { lastStatusSyncAt: null },
    { lastStatusEventAt: new Date("2026-10-03") },
    { shippedAt: labelsAt },
    { deliveredAt: labelsAt },
    { events: [...deleted.events, { status: "PICKED_UP", providerStatusCode: "PICKEDUP", occurredAt: labelsAt }] },
    { events: [...deleted.events, { status: "FAILED", providerStatusCode: "DLV_FAIL_PHONE_ERR", occurredAt: labelsAt }] },
  ])("requires positive matching confirmation and no physical history: %j", async patch => {
    tx.shipment.findMany.mockResolvedValue([{ ...deleted, ...patch }]);
    await expect(check()).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it.each([
    { courierPickedUpAt: labelsAt },
    { orderItem: { warehouseDispatchedQty: 1 } },
    { shipmentId: "unrelated" },
    { providerParcelId: "unmatched-parcel" },
    { batch: { ...legacyLine.batch, status: "POSTING" } },
    { batch: { ...legacyLine.batch, status: "PICKED_UP" } },
    { batch: { ...legacyLine.batch, provider: "MYGLS" } },
    { batch: { ...legacyLine.batch, labelsCreatedAt: new Date("2026-10-03") } },
    { batch: { ...legacyLine.batch, labelsCreatedAt: new Date("2026-09-01") } },
  ])("never exempts physical, unmatched or newer picking: %j", async patch => {
    tx.pickupBatchLine.findMany.mockResolvedValue([{ ...legacyLine, ...patch }]);
    await expect(check()).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("blocks the whole order when another delivery is active", async () => {
    tx.shipment.findMany.mockResolvedValue([deleted, { ...deleted, id: "second", status: "CREATED" }]);
    await expect(check()).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });

  it("keeps missing carrier confirmation on legacy picking blocked", async () => {
    tx.shipment.findMany.mockResolvedValue([]);
    await expect(check()).rejects.toMatchObject({ code: "NOT_ALLOWED" });
  });
});
