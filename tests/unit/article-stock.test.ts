import { describe, expect, it } from "vitest";
import { computeArticleStock } from "@/lib/article-stock";

describe("article stock calculation", () => {
  const input = {
    aggregateStock: 17,
    warehouses: [
      {
        warehouseId: "dc",
        warehouseName: "DC",
        isDefault: true,
        qty: 12,
      },
      {
        warehouseId: "store",
        warehouseName: "Prodavnica",
        isDefault: false,
        qty: 5,
      },
    ],
    orderReservations: [
      { warehouseId: "dc", qty: 3, debited: false },
      { warehouseId: "store", qty: 1, debited: false },
    ],
    partnerReservations: [{ warehouseId: "dc", qty: 2 }],
    manualWeb: true,
    manualWholesale: true,
    manualExport: true,
  };

  it("separates physical, reserved and available quantities", () => {
    const result = computeArticleStock(input);
    expect(result.physicalTotal).toBe(17);
    expect(result.reservedTotal).toBe(6);
    expect(result.availableTotal).toBe(11);
    expect(result.dc).toMatchObject({
      physical: 12,
      reserved: 5,
      available: 7,
    });
  });

  it("uses the selected warehouse context and DC for channel thresholds", () => {
    const result = computeArticleStock({
      ...input,
      selectedWarehouseId: "store",
    });
    expect(result.contextual).toMatchObject({
      warehouseName: "Prodavnica",
      physical: 5,
      reserved: 1,
      available: 4,
    });
    expect(result.channels).toMatchObject({
      webAuto: true,
      wholesaleAuto: false,
      exportAuto: false,
    });
  });

  it("keeps all-location totals separate from the selected warehouse", () => {
    const result = computeArticleStock({
      ...input,
      selectedWarehouseId: "store",
    });
    expect(result).toMatchObject({
      physicalTotal: 17,
      reservedTotal: 6,
      availableTotal: 11,
      contextual: {
        warehouseId: "store",
        physical: 5,
        reserved: 1,
        available: 4,
      },
    });
  });

  it("keeps legacy early-debited reservations correct during the transition", () => {
    const result = computeArticleStock({
      ...input,
      warehouses: [
        { warehouseId: "dc", warehouseName: "DC", isDefault: true, qty: 9 },
      ],
      orderReservations: [{ warehouseId: "dc", qty: 3, debited: true }],
      partnerReservations: [],
    });
    expect(result.dc).toMatchObject({
      physical: 12,
      reserved: 3,
      available: 9,
    });
  });
});
