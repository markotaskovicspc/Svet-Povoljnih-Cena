import { describe, expect, it } from "vitest";
import { buildPickupPrintRows } from "@/lib/admin/pickup-print";

describe("pickup picking print", () => {
  it("prints every visible item once per picking group and counts its packages", () => {
    const base = {
      order: { number: "WEB-2026-0001" },
      reclamation: null,
      purpose: "ORDER_DELIVERY" as const,
    };
    const rows = buildPickupPrintRows([
      {
        ...base,
        id: "line-1",
        lineGroupKey: "order:1:X_EXPRESS",
        quantity: 1,
        orderItem: { id: "item-1", sku: "100", name: "Ergo Lux", qty: 1 },
      },
      {
        ...base,
        id: "line-2",
        lineGroupKey: "order:1:X_EXPRESS",
        quantity: 1,
        orderItem: { id: "item-2", sku: "200", name: "Urban Seat", qty: 1 },
      },
      {
        ...base,
        id: "line-3",
        lineGroupKey: "order:1:X_EXPRESS",
        quantity: 1,
        orderItem: { id: "item-3", sku: "300", name: "Clean Box", qty: 1 },
      },
      {
        ...base,
        id: "line-4",
        lineGroupKey: "order:1:X_EXPRESS",
        quantity: 1,
        orderItem: { id: "item-3", sku: "300", name: "Clean Box", qty: 1 },
      },
    ]);

    expect(rows.map((row) => row.name)).toEqual([
      "Ergo Lux",
      "Urban Seat",
      "Clean Box",
    ]);
    expect(rows.map((row) => row.packageCount)).toEqual([1, 1, 2]);
  });

  it("does not silently drop a legacy line whose item relation is missing", () => {
    const rows = buildPickupPrintRows([
      {
        id: "legacy-line",
        lineGroupKey: "order:legacy:MYGLS",
        quantity: null,
        order: { number: "WEB-LEGACY" },
        reclamation: null,
        purpose: "ORDER_DELIVERY",
        orderItem: null,
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        source: "WEB-LEGACY",
        sku: "—",
        name: "Artikal više nije povezan sa porudžbinom",
        packageCount: 1,
      }),
    ]);
  });
});
