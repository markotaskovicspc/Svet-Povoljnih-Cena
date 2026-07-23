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
      { warehouseId: "dc", qty: 3 },
      { warehouseId: "store", qty: 1 },
    ],
    partnerReservations: [{ warehouseId: "dc", qty: 2 }],
    manualWeb: true,
    manualWholesale: true,
    manualExport: true,
  };

  it("separates physical, reserved and available quantities", () => {
    const result = computeArticleStock(input);
    expect(result.physicalTotal).toBe(21);
    expect(result.reservedTotal).toBe(6);
    expect(result.availableTotal).toBe(15);
    expect(result.dc).toMatchObject({
      physical: 15,
      reserved: 5,
      available: 10,
    });
  });

  it("uses the selected warehouse context and DC for channel thresholds", () => {
    const result = computeArticleStock({
      ...input,
      selectedWarehouseId: "store",
    });
    expect(result.contextual).toMatchObject({
      warehouseName: "Prodavnica",
      physical: 6,
      reserved: 1,
      available: 5,
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
      physicalTotal: 21,
      reservedTotal: 6,
      availableTotal: 15,
      contextual: {
        warehouseId: "store",
        physical: 6,
        reserved: 1,
        available: 5,
      },
    });
  });
});
