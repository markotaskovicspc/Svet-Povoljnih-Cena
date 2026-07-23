import { describe, expect, it } from "vitest";
import {
  calculateDeliveryDate,
  calculatePurchaseOrderFinancials,
  calculateUnitLogistics,
  isPackQuantityValid,
  PURCHASE_ORDER_EMAIL_BODY,
  purchaseOrderCapacityWarnings,
  purchaseOrderEmailSubject,
} from "@/lib/admin/purchase-order";

describe("ERP module 4 purchase-order rules", () => {
  it("calculates delivery from loading date and transit days first", () => {
    expect(
      calculateDeliveryDate({
        orderDate: new Date("2026-07-01T00:00:00.000Z"),
        loadingDate: new Date("2026-07-10T00:00:00.000Z"),
        deliveryDays: 30,
        transitDays: 4,
      })?.toISOString(),
    ).toBe("2026-07-14T00:00:00.000Z");
  });

  it("falls back to order date and supplier delivery days", () => {
    expect(
      calculateDeliveryDate({
        orderDate: new Date("2026-07-01T00:00:00.000Z"),
        loadingDate: null,
        deliveryDays: 21,
        transitDays: 4,
      })?.toISOString(),
    ).toBe("2026-07-22T00:00:00.000Z");
  });

  it("uses package dimensions per item and falls back to article dimensions", () => {
    expect(
      calculateUnitLogistics({
        packQty: 2,
        packWidthCm: 100,
        packDepthCm: 50,
        packHeightCm: 40,
        packGrossWeightKg: 20,
      }),
    ).toEqual({ volumeM3: 0.1, weightKg: 10 });
    expect(
      calculateUnitLogistics({
        widthCm: 100,
        depthCm: 50,
        heightCm: 40,
        grossWeightKg: 18,
      }),
    ).toEqual({ volumeM3: 0.2, weightKg: 18 });
  });

  it("marks quantities that are not divisible by package size", () => {
    expect(isPackQuantityValid(12, 4)).toBe(true);
    expect(isPackQuantityValid(10, 4)).toBe(false);
    expect(isPackQuantityValid(10, null)).toBe(true);
  });

  it("allocates freight, converts purchase price and calculates customs and BM", () => {
    const result = calculatePurchaseOrderFinancials({
      exchangeRate: 120,
      freightCost: 100,
      freightExchangeRate: 120,
      lines: [
        {
          id: "a",
          qty: 10,
          purchasePrice: 10,
          calcRetailPrice: 3_600,
          customsRatePct: 10,
          totalVolumeM3: 9,
          totalWeightKg: 1,
        },
        {
          id: "b",
          qty: 10,
          purchasePrice: 10,
          calcRetailPrice: 3_600,
          customsRatePct: 10,
          totalVolumeM3: 1,
          totalWeightKg: 9,
        },
      ],
    });

    expect(result.totalFreightRsd).toBe(12_000);
    expect(result.lines[0].freightAllocatedRsd).toBe(6_000);
    expect(result.lines[1].freightAllocatedRsd).toBe(6_000);
    expect(result.lines[0]).toEqual(
      expect.objectContaining({
        purchasePriceRsd: 1_200,
        freightPerUnitRsd: 600,
        customsPerUnitRsd: 180,
        bmPct: 34,
      }),
    );
    expect(result.totalBmPct).toBe(34);
  });

  it("returns capacity warnings for both dimensions", () => {
    expect(
      purchaseOrderCapacityWarnings({
        totalVolumeM3: 91,
        totalWeightKg: 24_001,
        payloadM3: 90,
        payloadKg: 24_000,
      }),
    ).toHaveLength(2);
    expect(
      purchaseOrderCapacityWarnings({
        totalVolumeM3: 90,
        totalWeightKg: 24_000,
        payloadM3: 90,
        payloadKg: 24_000,
      }),
    ).toEqual([]);
  });

  it("uses the exact requested supplier email subject and body", () => {
    expect(purchaseOrderEmailSubject("12/26")).toBe("Order NO 12/26");
    expect(PURCHASE_ORDER_EMAIL_BODY).toBe(
      "Dear,\nPlease kindly confirm receipt of our new order.\nIf any parameters or specifications of the order are not suitable or require adjustment, please inform us by email and specify which parts need to be revised.\n\nBest regards",
    );
  });
});
