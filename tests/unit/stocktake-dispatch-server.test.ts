import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  adjustInventory: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/inventory", () => ({
  adjustInventory: mocks.adjustInventory,
}));

import { postStocktakeDispatches } from "@/lib/admin/stocktake-dispatch.server";

describe("stocktake dispatch posting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (run) =>
      run({
        dispatchNote: {
          findUnique: mocks.findUnique,
          updateMany: mocks.updateMany,
        },
      }),
    );
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.adjustInventory.mockResolvedValue({ id: "movement-1" });
  });

  it("locks a STOCKTAKE dispatch, enforces destination Popis and removes source stock", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "dispatch-1",
      number: "POP-2030-0001",
      type: "STOCKTAKE",
      status: "DRAFT",
      sourceWarehouseId: "warehouse-1",
      items: [
        {
          id: "item-1",
          productId: "product-1",
          sku: "SKU-1",
          qty: 3,
        },
      ],
    });

    await expect(postStocktakeDispatches(["dispatch-1"], "admin-1")).resolves.toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "POSTED",
          destinationWarehouseId: null,
          destinationName: "Popis",
          actorId: "admin-1",
        }),
      }),
    );
    expect(mocks.adjustInventory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dispatchNoteId: "dispatch-1",
        warehouseId: "warehouse-1",
        productId: "product-1",
        qtyDelta: -3,
        kind: "STOCK_COUNT",
      }),
    );
  });

  it("rejects an empty popis before changing its status", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "dispatch-1",
      number: "POP-2030-0001",
      type: "STOCKTAKE",
      status: "DRAFT",
      sourceWarehouseId: "warehouse-1",
      items: [],
    });

    await expect(postStocktakeDispatches(["dispatch-1"], "admin-1")).rejects.toThrow(
      "nema nijednu stavku",
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.adjustInventory).not.toHaveBeenCalled();
  });
});
