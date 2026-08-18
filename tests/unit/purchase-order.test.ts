import { describe, expect, it } from "vitest";
import {
  calculateDeliveryDate,
  calculatePurchaseOrderFinancials,
  calculateUnitLogistics,
  canReceivePurchaseOrder,
  hasProductVolumeSource,
  isPackQuantityValid,
  productLogisticsSource,
  PURCHASE_ORDER_EMAIL_BODY,
  purchaseOrderCapacityWarnings,
  purchaseOrderEmailSubject,
  resolvePurchaseOrderLineLogistics,
  resolveOpenPurchaseOrderCustomsRate,
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

  it("predlaže isporuku 15 dana posle isporuke u luku", () => {
    expect(
      calculateDeliveryDate({
        orderDate: new Date("2026-07-01T00:00:00.000Z"),
        loadingDate: new Date("2026-07-10T00:00:00.000Z"),
        portDeliveryDate: new Date("2026-07-20T00:00:00.000Z"),
        deliveryDays: 30,
        transitDays: 4,
      })?.toISOString(),
    ).toBe("2026-08-04T00:00:00.000Z");
  });

  it("uses a complete container pair first, then a complete transport package", () => {
    expect(
      calculateUnitLogistics({
        containerQty: 230,
        containerGrossWeightKg: 11_500,
        unitPackWidthCm: 10,
        unitPackDepthCm: 10,
        unitPackHeightCm: 10,
        packQty: 2,
        packWidthCm: 100,
        packDepthCm: 50,
        packHeightCm: 40,
        packGrossWeightKg: 20,
      }),
    ).toEqual({ volumeM3: 0.3, weightKg: 50 });
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
        grossWeightKg: 18,
      }),
    ).toEqual({ volumeM3: 0, weightKg: 18 });
    expect(
      calculateUnitLogistics({
        packWidthCm: 100,
        packDepthCm: 50,
        packHeightCm: 40,
        grossWeightKg: 18,
      }),
    ).toEqual({ volumeM3: 0, weightKg: 18 });
    expect(
      calculateUnitLogistics({
        containerQty: 1_900,
        containerGrossWeightKg: 760,
        packQty: 0,
        packWidthCm: 0,
        packDepthCm: 0,
        packHeightCm: 0,
      }),
    ).toEqual({ volumeM3: 0.036316, weightKg: 0.4 });
  });

  it("accepts container quantity alone or the complete package group", () => {
    expect(hasProductVolumeSource({ containerQty: 2_500 })).toBe(true);
    expect(
      hasProductVolumeSource({
        containerQty: 2_500,
        containerGrossWeightKg: 12_000,
      }),
    ).toBe(true);
    expect(
      hasProductVolumeSource({
        packQty: 2,
        packWidthCm: 80,
        packDepthCm: 40,
        packHeightCm: 25,
      }),
    ).toBe(true);
    expect(
      hasProductVolumeSource({
        packQty: 2,
        packWidthCm: 80,
        packDepthCm: 40,
        packHeightCm: null,
      }),
    ).toBe(false);
    expect(
      hasProductVolumeSource({
        unitPackWidthCm: 80,
        unitPackDepthCm: 40,
        unitPackHeightCm: 25,
      }),
    ).toBe(false);
    expect(hasProductVolumeSource({})).toBe(false);
  });

  it("selects container data when both logistics groups are complete", () => {
    expect(
      productLogisticsSource({
        containerQty: 230,
        containerGrossWeightKg: 11_500,
        packQty: 2,
        packWidthCm: 100,
        packDepthCm: 50,
        packHeightCm: 40,
      }),
    ).toBe("container");
  });

  it("repairs only a missing locked volume snapshot from container-priority master data", () => {
    expect(
      resolvePurchaseOrderLineLogistics({
        locked: true,
        qty: 10,
        snapshottedPackQty: null,
        snapshottedTotalVolumeM3: 0,
        snapshottedTotalWeightKg: 0,
        product: {
          containerQty: 690,
          containerGrossWeightKg: null,
          packQty: 1,
          packWidthCm: 200,
          packDepthCm: 100,
          packHeightCm: 50,
          grossWeightKg: 2,
        },
      }),
    ).toEqual({
      packQty: 1,
      totalVolumeM3: 1,
      totalWeightKg: 20,
      repairedLockedSnapshot: true,
    });
  });

  it("keeps a valid locked logistics snapshot even when the article master changes", () => {
    expect(
      resolvePurchaseOrderLineLogistics({
        locked: true,
        qty: 10,
        snapshottedPackQty: 4,
        snapshottedTotalVolumeM3: 7.5,
        snapshottedTotalWeightKg: 80,
        product: {
          containerQty: 690,
          packQty: 1,
          packWidthCm: 10,
          packDepthCm: 10,
          packHeightCm: 10,
        },
      }),
    ).toEqual({
      packQty: 4,
      totalVolumeM3: 7.5,
      totalWeightKg: 80,
      repairedLockedSnapshot: false,
    });
  });

  it("leaves a locked zero-volume snapshot blocked until a complete source exists", () => {
    expect(
      resolvePurchaseOrderLineLogistics({
        locked: true,
        qty: 10,
        snapshottedPackQty: null,
        snapshottedTotalVolumeM3: 0,
        snapshottedTotalWeightKg: 0,
        product: {
          packQty: 2,
          packWidthCm: 80,
          packDepthCm: 40,
          packHeightCm: null,
        },
      }),
    ).toEqual({
      packQty: 2,
      totalVolumeM3: 0,
      totalWeightKg: 0,
      repairedLockedSnapshot: false,
    });
  });

  it("marks quantities that are not divisible by package size", () => {
    expect(isPackQuantityValid(12, 4)).toBe(true);
    expect(isPackQuantityValid(10, 4)).toBe(false);
    expect(isPackQuantityValid(10, null)).toBe(true);
  });

  it("allows the invoice workflow to receive a posted draft order", () => {
    expect(
      canReceivePurchaseOrder({ status: "DRAFT", lockedAt: new Date() }),
    ).toBe(true);
    expect(
      canReceivePurchaseOrder({ status: "DRAFT", lockedAt: null }),
    ).toBe(false);
  });

  it("fills a missing open-order customs rate from the current article master", () => {
    expect(
      resolveOpenPurchaseOrderCustomsRate({
        itemCustomsRate: 0,
        productCustomsRate: 8,
      }),
    ).toBe(8);
    expect(
      resolveOpenPurchaseOrderCustomsRate({
        itemCustomsRate: null,
        productCustomsRate: 8,
      }),
    ).toBe(8);
    expect(
      resolveOpenPurchaseOrderCustomsRate({
        itemCustomsRate: 12,
        productCustomsRate: 8,
      }),
    ).toBe(12);
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
    expect(result.lines[0].freightAllocatedRsd).toBe(10_800);
    expect(result.lines[1].freightAllocatedRsd).toBe(1_200);
    expect(result.lines[0]).toEqual(
      expect.objectContaining({
        purchasePriceRsd: 1_200,
        freightPerUnitRsd: 1_080,
        customsPerUnitRsd: 120,
        bmPct: 20,
      }),
    );
    expect(result.lines[1]).toEqual(
      expect.objectContaining({
        freightPerUnitRsd: 120,
        customsPerUnitRsd: 120,
        bmPct: 52,
      }),
    );
    expect(result.totalBmPct).toBe(36);
  });

  it("calculates BM from the retail price reduced by the active loyalty discount", () => {
    const result = calculatePurchaseOrderFinancials({
      exchangeRate: 1,
      freightCost: 0,
      freightExchangeRate: 1,
      loyaltyDiscountPct: 10,
      lines: [
        {
          id: "loyalty",
          qty: 1,
          purchasePrice: 600,
          calcRetailPrice: 1_200,
          customsRatePct: 0,
          totalVolumeM3: 1,
          totalWeightKg: 1,
        },
      ],
    });

    expect(result.lines[0].bmPct).toBe(33.33);
    expect(result.totalBmPct).toBe(33.33);
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
