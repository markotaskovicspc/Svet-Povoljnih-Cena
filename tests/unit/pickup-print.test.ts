import { describe, expect, it } from "vitest";
import { buildPickupPrintRows } from "@/lib/admin/pickup-print";

describe("pickup picking print", () => {
  it("sums quantities by article across picking groups without double-counting packages", () => {
    const rows = buildPickupPrintRows([
      {
        id: "line-1",
        lineGroupKey: "order:1:X_EXPRESS",
        quantity: 2,
        orderItem: { id: "item-1", sku: "100", name: "Ergo Lux", qty: 2 },
      },
      {
        id: "line-2",
        lineGroupKey: "order:1:X_EXPRESS",
        quantity: 2,
        orderItem: { id: "item-1", sku: "100", name: "Ergo Lux", qty: 2 },
      },
      {
        id: "line-3",
        lineGroupKey: "order:2:X_EXPRESS",
        quantity: 3,
        orderItem: { id: "item-2", sku: "100", name: "Ergo Lux", qty: 3 },
      },
      {
        id: "line-4",
        lineGroupKey: "order:2:X_EXPRESS",
        quantity: 1,
        orderItem: { id: "item-3", sku: "200", name: "Urban Seat", qty: 1 },
      },
    ]);

    expect(rows).toEqual([
      {
        key: "sku:100",
        sku: "100",
        name: "Ergo Lux",
        quantity: 5,
        packageCount: 3,
      },
      {
        key: "sku:200",
        sku: "200",
        name: "Urban Seat",
        quantity: 1,
        packageCount: 1,
      },
    ]);
  });

  it("does not silently drop a legacy line whose item relation is missing", () => {
    const rows = buildPickupPrintRows([
      {
        id: "legacy-line",
        lineGroupKey: "order:legacy:MYGLS",
        quantity: null,
        orderItem: null,
      },
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        sku: "—",
        name: "Artikal više nije povezan sa porudžbinom",
        quantity: 0,
        packageCount: 1,
      }),
    ]);
  });

  it("prints the named spare part and explicitly excludes the complete article", () => {
    const rows = buildPickupPrintRows([
      {
        id: "part-line",
        lineGroupKey: "reclamation:1:X_EXPRESS",
        purpose: "RECLAMATION_REPLACEMENT",
        quantity: 0,
        reclamation: {
          resolution: "ZAMENA_DELA",
          resolutionNote: "ukrasna maska",
        },
        orderItem: {
          id: "chair-line",
          sku: "110081",
          name: "Kancelarijska stolica ERGO LUX",
          qty: 1,
        },
      },
    ]);

    expect(rows).toEqual([
      {
        key: "part:reclamation:1:X_EXPRESS",
        sku: "DEO ZA 110081",
        name: "ukrasna maska — NE SLATI CEO ARTIKAL (Kancelarijska stolica ERGO LUX)",
        quantity: 1,
        packageCount: 1,
      },
    ]);
  });
});
