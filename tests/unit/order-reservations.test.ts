import { describe, expect, it } from "vitest";
import { warehouseRestoreQty } from "@/lib/order-reservations";

const item = {
  id: "item-1",
  productId: "product-1",
  sku: "SKU-1",
  qty: 5,
  warehouseReservedQty: 5,
  warehouseDispatchedQty: 0,
  supplierReservedQty: 0,
};

describe("order reservation release", () => {
  it("does not add physical stock when a new-model reservation is cancelled", () => {
    expect(warehouseRestoreQty(item, false)).toBe(0);
  });

  it("restores only the undispatched part of a legacy early debit", () => {
    expect(
      warehouseRestoreQty(
        {
          ...item,
          warehouseDispatchedQty: 2,
        },
        true,
      ),
    ).toBe(3);
  });
});
