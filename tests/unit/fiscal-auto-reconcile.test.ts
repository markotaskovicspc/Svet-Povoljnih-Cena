import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  orderFindMany: vi.fn(),
  enqueueBackgroundJob: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    order: { findMany: mocks.orderFindMany },
  },
}));

vi.mock("@/lib/background-jobs", () => ({
  enqueueBackgroundJob: mocks.enqueueBackgroundJob,
}));

import { enqueueEligibleOrdersForFiscalization } from "@/lib/fiscal/auto-reconcile";

describe("hourly all-channel fiscal reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.orderFindMany.mockResolvedValue([]);
    mocks.enqueueBackgroundJob.mockResolvedValue({ id: "job-1", status: "QUEUED" });
  });

  it("scans eligible orders from every sales channel without a SALE document", async () => {
    await enqueueEligibleOrdersForFiscalization(25);

    expect(mocks.orderFindMany).toHaveBeenCalledWith({
      where: {
        channel: { in: ["WEB", "ANANAS", "MP", "VP", "INO"] },
        status: { notIn: ["OTKAZANO", "VRACENO"] },
        total: { gt: 0 },
        items: { some: {} },
        fiscalDocuments: { none: { kind: "SALE" } },
        shipments: {
          some: {
            purpose: "ORDER_DELIVERY",
            status: {
              in: [
                "PICKED_UP",
                "IN_TRANSIT",
                "OUT_FOR_DELIVERY",
                "DELIVERED",
              ],
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 25,
      select: {
        id: true,
        number: true,
        channel: true,
        paymentMethod: true,
      },
    });
  });

  it("queues picked-up prepaid orders with the pickup idempotency key", async () => {
    mocks.orderFindMany.mockResolvedValue([
      {
        id: "order-vp-1",
        number: "VP-2026-00013",
        channel: "VP",
        total: "12000.00",
        paymentMethod: "UPLATA_NA_RACUN",
        payments: [{ amount: "7000.00" }, { amount: "5000.00" }],
      },
    ]);

    await expect(enqueueEligibleOrdersForFiscalization()).resolves.toEqual({
      scanned: 1,
      eligible: 1,
      eligibleAdvance: 0,
      eligiblePickup: 1,
      queued: 1,
      skippedUnderpaid: 0,
      failed: 0,
    });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith({
      kind: "FISCAL_RECEIPT",
      payload: {
        orderId: "order-vp-1",
        source: "AUTO_PICKUP",
        paymentMethod: "UPLATA_NA_RACUN",
      },
      idempotencyKey: "fiscal-pickup:order-vp-1",
    });
  });

  it("queues picked-up cash-on-delivery orders from WEB with the pickup source", async () => {
    mocks.orderFindMany.mockResolvedValue([
      {
        id: "order-web-cod",
        number: "SPC-2026-000123",
        channel: "WEB",
        total: "8000.00",
        paymentMethod: "POUZECE_GOTOVINA",
        payments: [],
      },
    ]);

    await expect(enqueueEligibleOrdersForFiscalization()).resolves.toEqual({
      scanned: 1,
      eligible: 1,
      eligibleAdvance: 0,
      eligiblePickup: 1,
      queued: 1,
      skippedUnderpaid: 0,
      failed: 0,
    });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith({
      kind: "FISCAL_RECEIPT",
      payload: {
        orderId: "order-web-cod",
        source: "AUTO_PICKUP",
        paymentMethod: "POUZECE_GOTOVINA",
      },
      idempotencyKey: "fiscal-pickup:order-web-cod",
    });
  });

  it("uses courier pickup as the trigger regardless of recorded payment amount", async () => {
    mocks.orderFindMany.mockResolvedValue([
      {
        id: "order-vp-underpaid",
        number: "VP-2026-00014",
        channel: "VP",
        total: "12000.00",
        paymentMethod: "UPLATA_NA_RACUN",
        payments: [{ amount: "11999.00" }],
      },
    ]);

    await expect(enqueueEligibleOrdersForFiscalization()).resolves.toEqual({
      scanned: 1,
      eligible: 1,
      eligibleAdvance: 0,
      eligiblePickup: 1,
      queued: 1,
      skippedUnderpaid: 0,
      failed: 0,
    });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledWith({
      kind: "FISCAL_RECEIPT",
      payload: {
        orderId: "order-vp-underpaid",
        source: "AUTO_PICKUP",
        paymentMethod: "UPLATA_NA_RACUN",
      },
      idempotencyKey: "fiscal-pickup:order-vp-underpaid",
    });
  });

  it("continues scanning when one order cannot be queued", async () => {
    mocks.orderFindMany.mockResolvedValue([
      {
        id: "order-vp-fail",
        number: "VP-2026-00015",
        channel: "VP",
        total: "100.00",
        paymentMethod: "UPLATA_NA_RACUN",
        payments: [{ amount: "100.00" }],
      },
      {
        id: "order-vp-ok",
        number: "VP-2026-00016",
        channel: "VP",
        total: "100.00",
        paymentMethod: "UPLATA_NA_RACUN",
        payments: [{ amount: "100.00" }],
      },
    ]);
    mocks.enqueueBackgroundJob
      .mockRejectedValueOnce(new Error("temporary database error"))
      .mockResolvedValueOnce({ id: "job-ok", status: "QUEUED" });

    await expect(enqueueEligibleOrdersForFiscalization()).resolves.toEqual({
      scanned: 2,
      eligible: 2,
      eligibleAdvance: 0,
      eligiblePickup: 2,
      queued: 1,
      skippedUnderpaid: 0,
      failed: 1,
    });
    expect(mocks.enqueueBackgroundJob).toHaveBeenCalledTimes(2);
  });
});
