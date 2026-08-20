import { describe, expect, it } from "vitest";
import {
  calculateEditedWebOrderTotals,
  planWebOrderQuantityReduction,
} from "@/lib/admin/web-order-edit";

describe("WEB order item editing", () => {
  it("recalculates line totals, assembly, discounts and shipping", () => {
    expect(
      calculateEditedWebOrderTotals({
        lines: [
          {
            qty: 2,
            unitPriceFull: 1_000,
            unitPriceSale: 800,
            assemblyPrice: 100,
          },
          {
            qty: 1,
            unitPriceFull: 500,
            unitPriceSale: 500,
          },
        ],
        shipping: 299,
        requestedVoucherDiscount: 210,
        keepFirstPurchaseDiscount: true,
        keepSavedCardDiscount: true,
      }),
    ).toEqual({
      subtotal: 2_100,
      savings: 400,
      shipping: 299,
      assemblyTotal: 200,
      voucherDiscount: 210,
      firstPurchaseDiscount: 315,
      savedCardDiscount: 105,
      totalOrderDiscount: 630,
      total: 1_969,
    });
  });

  it("caps the discount stack at the merchandise subtotal", () => {
    const totals = calculateEditedWebOrderTotals({
      lines: [{ qty: 1, unitPriceFull: 100, unitPriceSale: 100 }],
      shipping: 299,
      requestedVoucherDiscount: 100,
      keepFirstPurchaseDiscount: true,
      keepSavedCardDiscount: true,
    });

    expect(totals.totalOrderDiscount).toBe(100);
    expect(totals.total).toBe(299);
    expect(
      totals.voucherDiscount +
        totals.firstPurchaseDiscount +
        totals.savedCardDiscount,
    ).toBe(100);
  });

  it("releases supplier allocation before warehouse allocation", () => {
    expect(
      planWebOrderQuantityReduction({
        currentQty: 5,
        newQty: 2,
        warehouseReservedQty: 2,
        supplierReservedQty: 3,
        legacyWarehouseDebited: false,
      }),
    ).toEqual({
      reductionQty: 3,
      supplierReleaseQty: 3,
      warehouseReleaseQty: 0,
      restorePhysicalWarehouseQty: 0,
      nextWarehouseReservedQty: 2,
      nextSupplierReservedQty: 0,
    });
  });

  it("restores only legacy physical stock and clears tracked reservation", () => {
    expect(
      planWebOrderQuantityReduction({
        currentQty: 4,
        newQty: 1,
        warehouseReservedQty: 4,
        supplierReservedQty: 0,
        legacyWarehouseDebited: true,
      }),
    ).toMatchObject({
      warehouseReleaseQty: 3,
      restorePhysicalWarehouseQty: 3,
      nextWarehouseReservedQty: 1,
    });

    expect(
      planWebOrderQuantityReduction({
        currentQty: 4,
        newQty: 1,
        warehouseReservedQty: 4,
        supplierReservedQty: 0,
        legacyWarehouseDebited: false,
      }),
    ).toMatchObject({
      warehouseReleaseQty: 3,
      restorePhysicalWarehouseQty: 0,
      nextWarehouseReservedQty: 1,
    });
  });

  it("rejects increases and inconsistent reservation state", () => {
    expect(() =>
      planWebOrderQuantityReduction({
        currentQty: 2,
        newQty: 2,
        warehouseReservedQty: 2,
        supplierReservedQty: 0,
        legacyWarehouseDebited: false,
      }),
    ).toThrow("samo da se smanji");

    expect(() =>
      planWebOrderQuantityReduction({
        currentQty: 3,
        newQty: 0,
        warehouseReservedQty: 1,
        supplierReservedQty: 0,
        legacyWarehouseDebited: false,
      }),
    ).toThrow("Rezervacija stavke nije potpuna");
  });
});
