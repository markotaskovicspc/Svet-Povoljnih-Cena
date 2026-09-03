import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adjustInventory: vi.fn(),
  syncAvailability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/inventory", () => ({
  adjustInventory: mocks.adjustInventory,
}));
vi.mock("@/lib/channel-availability.server", () => ({
  syncProductChannelAvailability: mocks.syncAvailability,
}));

function transactionMock(input: {
  item: {
    id: string;
    qty: number;
    productId: string;
    warehouseId: string | null;
    warehouseReservedQty: number;
    supplierReservedQty: number;
    stockMovements: Array<{ qty: number; fiscalDocumentId: string | null }>;
  };
  lines: Array<{
    id: string;
    orderItemId: string;
    productId: string;
    sku: string;
    qty: number;
  }>;
  issuedQty: number;
}) {
  return {
    $queryRaw: vi.fn(async () => [{ id: "locked" }]),
    fiscalDocument: {
      findUnique: vi.fn(async () => ({
        id: "fiscal-1",
        kind: "SALE",
        status: "ISSUED",
        order: { id: "order-1", number: "SPC-1" },
        lines: input.lines,
      })),
    },
    fiscalDocumentLine: {
      groupBy: vi.fn(async () => [
        {
          orderItemId: input.item.id,
          _sum: { qty: input.issuedQty },
        },
      ]),
    },
    orderItem: {
      findMany: vi.fn(async () => [input.item]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async () => {
      throw new Error("Test mora da podesi transakciju.");
    }),
  },
}));

import { db } from "@/lib/db";
import { ensureIssuedFiscalSaleInventoryPosted } from "@/lib/fiscal/inventory-posting";

describe("fiscal inventory posting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adjustInventory.mockResolvedValue({ id: "movement-1" });
    mocks.syncAvailability.mockResolvedValue(undefined);
  });

  it("posts split price-tier lines once and releases the allocation atomically", async () => {
    const tx = transactionMock({
      item: {
        id: "item-1",
        qty: 4,
        productId: "product-1",
        warehouseId: "warehouse-1",
        warehouseReservedQty: 4,
        supplierReservedQty: 0,
        stockMovements: [],
      },
      lines: [
        {
          id: "line-1",
          orderItemId: "item-1",
          productId: "product-1",
          sku: "SKU-1",
          qty: 3,
        },
        {
          id: "line-2",
          orderItemId: "item-1",
          productId: "product-1",
          sku: "SKU-1",
          qty: 1,
        },
      ],
      issuedQty: 4,
    });
    vi.mocked(db.$transaction).mockImplementationOnce(async (callback) =>
      callback(tx as never),
    );

    await expect(
      ensureIssuedFiscalSaleInventoryPosted("fiscal-1"),
    ).resolves.toEqual({ posted: true, warehouseLines: 1 });

    expect(mocks.adjustInventory).toHaveBeenCalledTimes(1);
    expect(mocks.adjustInventory).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        idempotencyKey: "fiscal-sale:fiscal-1:item-1",
        qtyDelta: -4,
      }),
    );
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: "item-1",
        warehouseReservedQty: 4,
        supplierReservedQty: 0,
      },
      data: {
        warehouseReservedQty: 0,
        supplierReservedQty: 0,
      },
    });
  });

  it("debits only the DC share and releases a completed mixed allocation", async () => {
    const tx = transactionMock({
      item: {
        id: "item-1",
        qty: 4,
        productId: "product-1",
        warehouseId: "warehouse-1",
        warehouseReservedQty: 2,
        supplierReservedQty: 2,
        stockMovements: [],
      },
      lines: [
        {
          id: "line-1",
          orderItemId: "item-1",
          productId: "product-1",
          sku: "SKU-1",
          qty: 4,
        },
      ],
      issuedQty: 4,
    });
    vi.mocked(db.$transaction).mockImplementationOnce(async (callback) =>
      callback(tx as never),
    );

    await ensureIssuedFiscalSaleInventoryPosted("fiscal-1");

    expect(mocks.adjustInventory).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ qtyDelta: -2 }),
    );
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { warehouseReservedQty: 0, supplierReservedQty: 0 },
      }),
    );
  });

  it("releases a supplier-only allocation without requiring a DC warehouse", async () => {
    const tx = transactionMock({
      item: {
        id: "item-1",
        qty: 1,
        productId: "product-1",
        warehouseId: null,
        warehouseReservedQty: 0,
        supplierReservedQty: 1,
        stockMovements: [],
      },
      lines: [
        {
          id: "line-1",
          orderItemId: "item-1",
          productId: "product-1",
          sku: "SKU-1",
          qty: 1,
        },
      ],
      issuedQty: 1,
    });
    vi.mocked(db.$transaction).mockImplementationOnce(async (callback) =>
      callback(tx as never),
    );

    await ensureIssuedFiscalSaleInventoryPosted("fiscal-1");

    expect(mocks.adjustInventory).not.toHaveBeenCalled();
    expect(tx.orderItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { warehouseReservedQty: 0, supplierReservedQty: 0 },
      }),
    );
  });
});
