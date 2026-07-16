import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  adjustInventory,
  InsufficientInventoryError,
} from "@/lib/inventory";

function transactionMock(options: { insufficient?: boolean } = {}) {
  let movement: Record<string, unknown> | null = null;
  const tx = {
    stockMovement: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) =>
        movement?.idempotencyKey === where.idempotencyKey ? movement : null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        movement = { id: "movement-1", ...data };
        return movement;
      }),
    },
    product: {
      findUnique: vi.fn(async () => ({ sku: "SKU-1", stock: 5 })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: options.insufficient ? 0 : 1 })),
    },
    warehouse: {
      findFirst: vi.fn(async () => ({ id: "warehouse-1", active: true })),
      findUnique: vi.fn(async () => ({ id: "warehouse-1", active: true })),
      upsert: vi.fn(),
    },
    warehouseStock: {
      upsert: vi.fn(async () => ({ qty: 5 })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: options.insufficient ? 0 : 1 })),
    },
  };
  return tx as unknown as Prisma.TransactionClient;
}

describe("inventory transactions", () => {
  it("returns the original movement when the same operation is retried", async () => {
    const tx = transactionMock();
    const command = {
      idempotencyKey: "order:1:reservation:line:1",
      productId: "product-1",
      qtyDelta: 2,
      kind: "ADJUSTMENT" as const,
      note: "Test",
    };

    const first = await adjustInventory(tx, command);
    const second = await adjustInventory(tx, command);

    expect(second).toEqual(first);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.warehouseStock.update).toHaveBeenCalledTimes(1);
    expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a reservation that would make stock negative", async () => {
    const tx = transactionMock({ insufficient: true });
    await expect(
      adjustInventory(tx, {
        idempotencyKey: "order:2:reservation:line:1",
        productId: "product-1",
        qtyDelta: -6,
        kind: "SALE_RESERVATION",
        note: "Test",
      }),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);
    expect(tx.stockMovement.create).not.toHaveBeenCalled();
  });
});
