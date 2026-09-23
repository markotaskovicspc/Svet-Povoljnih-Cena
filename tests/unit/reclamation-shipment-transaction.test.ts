import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createShipmentForOrder: vi.fn(),
  adjustInventory: vi.fn(),
  updateReclamation: vi.fn(),
  findReclamation: vi.fn(),
  announce: vi.fn(),
  insideTransaction: false,
}));

const transactionClient = {
  reclamation: { update: mocks.updateReclamation },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    reclamation: { findUnique: mocks.findReclamation },
    $transaction: vi.fn(async (callback: (tx: typeof transactionClient) => unknown) => {
      mocks.insideTransaction = true;
      try {
        return await callback(transactionClient);
      } finally {
        mocks.insideTransaction = false;
      }
    }),
  },
}));
vi.mock("@/lib/courier/registry", () => ({
  createShipmentForOrder: mocks.createShipmentForOrder,
  preflightShipmentForOrder: vi.fn(),
}));
vi.mock("@/lib/x-express/shipments", () => ({ announceXExpressShipment: mocks.announce }));
vi.mock("@/lib/inventory", () => ({
  adjustInventory: mocks.adjustInventory,
  ensureDefaultWarehouse: vi.fn(),
}));
vi.mock("@/lib/mygls/shipments", () => ({
  deleteMyGlsLabelsForShipment: vi.fn(),
}));
vi.mock("@/lib/mygls/config", () => ({
  MYGLS_PROVIDER: "MYGLS",
}));
vi.mock("@/lib/admin/return-warehouse", () => ({
  isReturnWarehouse: vi.fn(),
}));

import { createReclamationShipment } from "@/lib/admin/reclamation-fulfillment.server";

describe("reclamation shipment transaction boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insideTransaction = false;
    mocks.findReclamation.mockResolvedValue({
      id: "reclamation-1",
      orderId: "order-1",
      decision: "PRIHVACENA",
      resolution: "ZAMENA_ARTIKLA",
      productId: "product-1",
      orderItemId: "item-1",
      sku: "SKU-1",
      quantity: 1,
      replacementQty: 1,
      warehouseId: "warehouse-1",
      warehouseStatus: "READY",
      pickupBatchLines: [{ batchId: "batch-1" }],
      shipments: [],
    });
    mocks.createShipmentForOrder.mockImplementation(async () => {
      expect(mocks.insideTransaction).toBe(false);
      return { id: "shipment-1", status: "CREATED" };
    });
    mocks.adjustInventory.mockImplementation(async () => {
      expect(mocks.insideTransaction).toBe(true);
      return { id: "movement-1" };
    });
    mocks.updateReclamation.mockResolvedValue({ id: "reclamation-1" });
  });

  it("calls the courier before opening the short inventory transaction", async () => {
    await expect(
      createReclamationShipment({
        reclamationId: "reclamation-1",
        purpose: "RECLAMATION_REPLACEMENT",
        provider: "X_EXPRESS",
        fromPickupBatch: true,
        actorId: "admin-1",
      }),
    ).resolves.toMatchObject({ id: "shipment-1" });

    expect(mocks.createShipmentForOrder).toHaveBeenCalledTimes(1);
    expect(mocks.adjustInventory).toHaveBeenCalledWith(
      transactionClient,
      expect.objectContaining({
        idempotencyKey: "reclamation-replacement:reclamation-1:out",
        qtyDelta: -1,
      }),
    );
    expect(mocks.updateReclamation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouseStatus: "HANDED_OVER" }),
      }),
    );
  });

  it("creates only a zero-COD pickup for a refund without requiring a replacement or issuing stock", async () => {
    const reclamation = await mocks.findReclamation();
    mocks.findReclamation.mockResolvedValue({
      ...reclamation, resolution: "POVRAT_NOVCA", replacementQty: 0,
      warehouseStatus: "NOT_REQUESTED", pickupBatchLines: [],
    });
    const coordinates = { latitude: 44.81, longitude: 20.46 };
    await createReclamationShipment({
      reclamationId: "reclamation-1", purpose: "RECLAMATION_RETURN",
      returnPickupCoordinates: coordinates, packageCount: 2,
    });
    expect(mocks.createShipmentForOrder).toHaveBeenCalledExactlyOnceWith("order-1", expect.objectContaining({
      purpose: "RECLAMATION_RETURN", codAmount: 0,
      returnPickupCoordinates: coordinates, packageCount: 2,
    }));
    expect(mocks.adjustInventory).not.toHaveBeenCalled();
    expect(mocks.updateReclamation).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ warehouseStatus: "REQUESTED" }),
    }));
  });

  it("does not report an uncertain earlier pickup request as booked or send it twice", async () => {
    const reclamation = await mocks.findReclamation();
    mocks.findReclamation.mockResolvedValue({ ...reclamation, shipments: [{
      id: "prepared", provider: "X_EXPRESS", status: "CREATED",
      providerShipmentId: null, providerStatusCode: "LOCAL_ANNOUNCEMENT_FAILED",
    }] });
    await expect(createReclamationShipment({
      reclamationId: "reclamation-1", purpose: "RECLAMATION_RETURN",
    })).rejects.toThrow(/nije potvrdio preuzimanje/);
    expect(mocks.createShipmentForOrder).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
    expect(mocks.updateReclamation).not.toHaveBeenCalled();
  });

  it("announces a prepared return using its existing shipment and tracking number", async () => {
    const reclamation = await mocks.findReclamation();
    const prepared = { id: "prepared", provider: "X_EXPRESS", status: "CREATED", providerShipmentId: null, providerStatusCode: "LOCAL_PREPARED" };
    mocks.findReclamation.mockResolvedValue({ ...reclamation, shipments: [prepared] });
    mocks.announce.mockResolvedValue({ ...prepared, providerShipmentId: "provider-guid" });
    await expect(createReclamationShipment({
      reclamationId: "reclamation-1", purpose: "RECLAMATION_RETURN",
    })).resolves.toMatchObject({ id: "prepared", providerShipmentId: "provider-guid" });
    expect(mocks.createShipmentForOrder).not.toHaveBeenCalled();
    expect(mocks.announce).toHaveBeenCalledExactlyOnceWith("prepared");
  });
});
