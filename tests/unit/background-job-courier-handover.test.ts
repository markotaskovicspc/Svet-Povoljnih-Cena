import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobUpdateMany: vi.fn(),
  jobFindUnique: vi.fn(),
  jobUpdate: vi.fn(),
  jobCreate: vi.fn(),
  pickupLinesFindMany: vi.fn(),
  shipmentFindUnique: vi.fn(),
  applyShipmentEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    backgroundJob: {
      updateMany: mocks.jobUpdateMany,
      findUnique: mocks.jobFindUnique,
      update: mocks.jobUpdate,
      create: mocks.jobCreate,
    },
    pickupBatchLine: { findMany: mocks.pickupLinesFindMany },
    shipment: { findUnique: mocks.shipmentFindUnique },
  },
}));

vi.mock("@/lib/channel-availability.server", () => ({
  expirePartnerReservations: vi.fn(),
  disableInvalidRabaluxWebAvailability: vi.fn(),
}));

vi.mock("@/lib/courier", () => ({
  applyShipmentEvent: mocks.applyShipmentEvent,
}));

import { processBackgroundJob } from "@/lib/background-jobs";

const payload = {
  batchId: "batch-1",
  batchNumber: "PRE-2026-0001",
  lineGroupKey: "order:order-1:X_EXPRESS",
  shipmentId: "shipment-1",
  actorId: "admin-1",
  occurredAt: "2026-08-28T17:00:00.000Z",
};

describe("courier handover background job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.jobFindUnique.mockResolvedValue({
      id: "job-handover-1",
      kind: "COURIER_HANDOVER",
      payload,
      attempts: 1,
      maxAttempts: 8,
    });
    mocks.jobUpdate.mockResolvedValue({});
    mocks.jobCreate
      .mockResolvedValueOnce({ id: "job-fiscal-1", status: "QUEUED" })
      .mockResolvedValueOnce({ id: "job-email-1", status: "QUEUED" });
    mocks.pickupLinesFindMany.mockResolvedValue([
      {
        courierPickedUpAt: new Date(payload.occurredAt),
        orderId: "order-1",
        reclamationId: null,
        purpose: "ORDER_DELIVERY",
      },
      {
        courierPickedUpAt: new Date(payload.occurredAt),
        orderId: "order-1",
        reclamationId: null,
        purpose: "ORDER_DELIVERY",
      },
    ]);
    mocks.shipmentFindUnique.mockResolvedValue({
      id: "shipment-1",
      orderId: "order-1",
      trackingNo: "AAA0850300001",
      service: "COURIER_SMALL",
      purpose: "ORDER_DELIVERY",
      reclamationId: null,
      status: "CREATED",
    });
    mocks.applyShipmentEvent.mockResolvedValue({
      shipmentId: "shipment-1",
      orderId: "order-1",
      status: "PICKED_UP",
      orderStatus: "SPREMNO_ZA_ISPORUKU",
      customerEmail: "buyer@example.invalid",
      customerPhone: null,
      eventCreated: true,
      stateApplied: true,
    });
  });

  it("records physical pickup and idempotently queues fiscalization and email", async () => {
    await expect(processBackgroundJob("job-handover-1")).resolves.toEqual({
      claimed: true,
      ok: true,
    });

    expect(mocks.applyShipmentEvent).toHaveBeenCalledWith("COURIER_SMALL", {
      trackingNo: "AAA0850300001",
      status: "PICKED_UP",
      providerStatusCode: "WAREHOUSE_HANDOVER",
      providerEventId: `pickup-batch:${payload.batchId}:${payload.lineGroupKey}`,
      occurredAt: new Date(payload.occurredAt),
      message:
        "Kurir je fizički preuzeo pošiljku prema nalogu za preuzimanje PRE-2026-0001.",
      raw: {
        source: "PICKUP_BATCH_HANDOVER",
        batchId: payload.batchId,
        batchNumber: payload.batchNumber,
        lineGroupKey: payload.lineGroupKey,
        actorId: payload.actorId,
      },
    });
    expect(mocks.jobCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "FISCAL_RECEIPT",
          payload: { orderId: "order-1", source: "AUTO_PICKUP" },
          idempotencyKey: "fiscal-pickup:order-1",
        }),
      }),
    );
    expect(mocks.jobCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "ORDER_STATUS_EMAIL",
          idempotencyKey: "order-status-email:order-1:PICKED_UP",
        }),
      }),
    );
  });

  it("recovers side effects when the shipment was already marked as picked up", async () => {
    mocks.shipmentFindUnique.mockResolvedValue({
      id: "shipment-1",
      orderId: "order-1",
      trackingNo: "AAA0850300001",
      service: "COURIER_SMALL",
      purpose: "ORDER_DELIVERY",
      reclamationId: null,
      status: "PICKED_UP",
    });

    await expect(processBackgroundJob("job-handover-1")).resolves.toEqual({
      claimed: true,
      ok: true,
    });

    expect(mocks.applyShipmentEvent).not.toHaveBeenCalled();
    expect(mocks.jobCreate).toHaveBeenCalledTimes(2);
  });

  it("fails permanently when only part of the picking group is marked", async () => {
    mocks.pickupLinesFindMany.mockResolvedValue([
      {
        courierPickedUpAt: new Date(payload.occurredAt),
        orderId: "order-1",
        reclamationId: null,
        purpose: "ORDER_DELIVERY",
      },
      {
        courierPickedUpAt: null,
        orderId: "order-1",
        reclamationId: null,
        purpose: "ORDER_DELIVERY",
      },
    ]);

    await expect(processBackgroundJob("job-handover-1")).resolves.toEqual({
      claimed: true,
      ok: false,
      exhausted: true,
      permanent: true,
    });

    expect(mocks.applyShipmentEvent).not.toHaveBeenCalled();
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect(mocks.jobUpdate).toHaveBeenLastCalledWith({
      where: { id: "job-handover-1" },
      data: expect.objectContaining({
        status: "FAILED",
        lastError: expect.stringContaining("[permanent]"),
      }),
    });
  });
});
