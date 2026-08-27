import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobUpdateMany: vi.fn(),
  jobFindUnique: vi.fn(),
  jobUpdate: vi.fn(),
  shipmentFindFirst: vi.fn(),
  issueAndDeliverFiscalReceipt: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    backgroundJob: {
      updateMany: mocks.jobUpdateMany,
      findUnique: mocks.jobFindUnique,
      update: mocks.jobUpdate,
    },
    shipment: { findFirst: mocks.shipmentFindFirst },
  },
}));

vi.mock("@/lib/channel-availability.server", () => ({
  expirePartnerReservations: vi.fn(),
  disableInvalidRabaluxWebAvailability: vi.fn(),
}));

vi.mock("@/lib/fiscal", () => ({
  issueAndDeliverFiscalReceipt: mocks.issueAndDeliverFiscalReceipt,
}));

import { processBackgroundJob } from "@/lib/background-jobs";

describe("fiscal background-job pickup guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.jobFindUnique.mockResolvedValue({
      id: "job-fiscal-1",
      kind: "FISCAL_RECEIPT",
      payload: {
        orderId: "order-1",
        source: "AUTO_ADVANCE",
        paymentMethod: "IPS",
      },
      attempts: 1,
      maxAttempts: 8,
    });
    mocks.jobUpdate.mockResolvedValue({});
    mocks.issueAndDeliverFiscalReceipt.mockResolvedValue({
      outcome: {
        ok: true,
        created: true,
        receipt: {},
        order: {},
      },
      emailed: true,
    });
  });

  it("completes a stale advance job without fiscalizing before pickup", async () => {
    mocks.shipmentFindFirst.mockResolvedValue(null);

    await expect(processBackgroundJob("job-fiscal-1")).resolves.toEqual({
      claimed: true,
      ok: true,
    });

    expect(mocks.shipmentFindFirst).toHaveBeenCalledWith({
      where: {
        orderId: "order-1",
        purpose: "ORDER_DELIVERY",
        status: {
          in: ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"],
        },
      },
      select: { id: true },
    });
    expect(mocks.issueAndDeliverFiscalReceipt).not.toHaveBeenCalled();
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      where: { id: "job-fiscal-1" },
      data: expect.objectContaining({ status: "COMPLETED", payload: {} }),
    });
  });

  it("fiscalizes the same automated job after courier pickup", async () => {
    mocks.shipmentFindFirst.mockResolvedValue({ id: "shipment-1" });

    await expect(processBackgroundJob("job-fiscal-1")).resolves.toEqual({
      claimed: true,
      ok: true,
    });

    expect(mocks.issueAndDeliverFiscalReceipt).toHaveBeenCalledWith("order-1", {
      source: "AUTO_ADVANCE",
      paymentMethod: "IPS",
    });
  });

  it("keeps the explicit manual fiscalization override available", async () => {
    mocks.jobFindUnique.mockResolvedValue({
      id: "job-fiscal-1",
      kind: "FISCAL_RECEIPT",
      payload: {
        orderId: "order-1",
        source: "MANUAL",
        paymentMethod: "IPS",
      },
      attempts: 1,
      maxAttempts: 8,
    });

    await expect(processBackgroundJob("job-fiscal-1")).resolves.toEqual({
      claimed: true,
      ok: true,
    });

    expect(mocks.shipmentFindFirst).not.toHaveBeenCalled();
    expect(mocks.issueAndDeliverFiscalReceipt).toHaveBeenCalledWith("order-1", {
      source: "MANUAL",
      paymentMethod: "IPS",
    });
  });
});
