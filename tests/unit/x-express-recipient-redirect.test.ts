import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadShipment: vi.fn(),
  loadLockedShipment: vi.fn(),
  findEvent: vi.fn(),
  createEvent: vi.fn(),
  updateShipment: vi.fn(),
  updateOrder: vi.fn(),
  updatePickup: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    shipment: { findFirst: mocks.loadShipment },
    adminSetting: { findUnique: vi.fn(async () => ({ value: "X_EXPRESS" })) },
    $transaction: async (run: (tx: unknown) => Promise<void>) => run({
      $queryRaw: vi.fn(),
      shipment: {
        findUniqueOrThrow: mocks.loadLockedShipment,
        updateMany: mocks.updateShipment,
      },
      shipmentEvent: {
        findUnique: mocks.findEvent,
        findFirst: mocks.findEvent,
        create: mocks.createEvent,
      },
      order: { update: mocks.updateOrder },
      pickupBatchLine: { updateMany: mocks.updatePickup },
    }),
  },
}));

import { applyShipmentEvent } from "@/lib/courier/registry";

const physicalEventAt = new Date("2026-09-14T06:32:35Z");
const redirect = {
  trackingNo: "AAA0850300836",
  status: "CREATED" as const,
  providerStatusCode: "RCP_DLV_TO_PUDO",
  providerEventId: "redirect-notify",
  occurredAt: new Date("2026-09-14T06:34:28Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findEvent.mockResolvedValue(null);
  mocks.updateShipment.mockResolvedValue({ count: 1 });
});

function shipmentAt(status: string, lastStatusEventAt = physicalEventAt) {
  const shipment = {
    id: "shipment-1", orderId: "order-1", provider: "X_EXPRESS",
    status, lastStatusEventAt, rawCreateResponse: null,
    order: { user: null, guestEmail: null, shipPhone: "0600000000" },
  };
  mocks.loadShipment.mockResolvedValue(shipment);
  mocks.loadLockedShipment.mockResolvedValue(shipment);
}

describe("X Express recipient PUDO instruction", () => {
  it.each(["CREATED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "FAILED"])(
    "preserves %s without marking pickup, changing the order or triggering notifications",
    async (status) => {
      shipmentAt(status);
      const result = await applyShipmentEvent("COURIER_SMALL", redirect);
      expect(result).toMatchObject({ status, eventCreated: true, stateApplied: false, orderStatus: null });
      expect(mocks.createEvent).toHaveBeenCalledWith({ data: expect.objectContaining({
        status, providerStatusCode: "RCP_DLV_TO_PUDO",
        message: "Primalac je zatražio preusmeravanje na PUDO.",
      }) });
      const data = mocks.updateShipment.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("status");
      expect(data).not.toHaveProperty("lastStatusEventAt");
      expect(data).not.toHaveProperty("shippedAt");
      expect(mocks.updateOrder).not.toHaveBeenCalled();
      expect(mocks.updatePickup).not.toHaveBeenCalled();
    },
  );

  it("deduplicates recipient notifications", async () => {
    shipmentAt("CREATED");
    mocks.findEvent.mockResolvedValue({ id: "already-processed" });
    expect(await applyShipmentEvent("COURIER_SMALL", redirect)).toMatchObject({
      eventCreated: false, stateApplied: false,
    });
    expect(mocks.createEvent).not.toHaveBeenCalled();
    expect(mocks.updateShipment).not.toHaveBeenCalled();
  });

  it("records late instructions without replacing newer carrier metadata", async () => {
    shipmentAt("PICKED_UP", new Date("2026-09-14T07:00:00Z"));
    await applyShipmentEvent("COURIER_SMALL", redirect);
    expect(mocks.createEvent).toHaveBeenCalled();
    expect(mocks.updateShipment).not.toHaveBeenCalled();
  });
});
