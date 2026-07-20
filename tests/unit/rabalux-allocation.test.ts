import { describe, expect, it } from "vitest";
import {
  allocateStock,
  effectiveSellableStock,
} from "@/lib/rabalux/allocation";

describe("Rabalux stock allocation", () => {
  it("subtracts local supplier reservations from effective stock", () => {
    expect(
      effectiveSellableStock({
        warehouseStock: 2,
        supplierStock: 8,
        supplierReservedStock: 3,
      }),
    ).toBe(7);
  });

  it("allocates owned stock first and then supplier stock", () => {
    expect(
      allocateStock(5, {
        warehouseStock: 2,
        supplierStock: 8,
        supplierReservedStock: 3,
      }),
    ).toEqual({ warehouseQty: 2, supplierQty: 3 });
  });

  it("rejects overselling even when raw feed stock is high but reserved", () => {
    expect(
      allocateStock(3, {
        warehouseStock: 0,
        supplierStock: 10,
        supplierReservedStock: 8,
      }),
    ).toBeNull();
  });

  it("does not let a refreshed feed erase local reservations", () => {
    expect(
      effectiveSellableStock({
        warehouseStock: 0,
        supplierStock: 4,
        supplierReservedStock: 6,
      }),
    ).toBe(0);
  });
});
