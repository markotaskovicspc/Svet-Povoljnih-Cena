import { describe, expect, it } from "vitest";
import { buildPickupPrintRows } from "@/lib/admin/pickup-print";

describe("pickup picking print", () => {
  it("sums quantities by article across picking groups without double-counting packages", () => {
    const rows = buildPickupPrintRows([
      {
        id: "line-1",
        lineGroupKey: "order:1:X_EXPRESS",
        quantity: 2,
        orderItem: {
          id: "item-1", sku: "100", name: "Ergo Lux", qty: 2,
          product: { barcode: "0012345678905" },
        },
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
        orderItem: {
          id: "item-3", sku: "200", name: "Urban Seat", qty: 1,
          product: { barcode: null },
        },
      },
    ]);

    expect(rows).toEqual([
      {
        key: "sku:100",
        sku: "100",
        name: "Ergo Lux",
        barcode: "0012345678905",
        category: "Bez kategorije", color: "",
        quantity: 5,
        packageCount: 3,
        quantityDistribution: [{ quantity: 3, orderCount: 1 }, { quantity: 2, orderCount: 1 }],
      },
      {
        key: "sku:200",
        sku: "200",
        name: "Urban Seat",
        barcode: null,
        category: "Bez kategorije", color: "",
        quantity: 1,
        packageCount: 1,
        quantityDistribution: [{ quantity: 1, orderCount: 1 }],
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
        barcode: null,
        category: "Bez kategorije", color: "",
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
          product: { barcode: "8601234567890" },
        },
      },
    ]);

    expect(rows).toEqual([
      {
        key: "part:reclamation:1:X_EXPRESS",
        sku: "DEO ZA 110081",
        name: "ukrasna maska — NE SLATI CEO ARTIKAL (Kancelarijska stolica ERGO LUX)",
        barcode: null,
        category: "Bez kategorije", color: "",
        quantity: 1,
        packageCount: 1,
        quantityDistribution: [{ quantity: 1, orderCount: 1 }],
      },
    ]);
  });

  it("shows the customer quantity breakdown without counting physical packages as customers", () => {
    const quantities = [4, 4, 4, 6, 1, 1];
    const rows = buildPickupPrintRows(quantities.flatMap((quantity, order) =>
      Array.from({ length: quantity }, (_, pkg) => ({
        id: `${order}-${pkg}`,
        lineGroupKey: `order:${order}:MYGLS`,
        quantity,
        orderItem: { id: `item-${order}`, sku: "CHAIR", name: "Trpezarijska stolica", qty: quantity },
      })),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quantity: 20,
      packageCount: 20,
      quantityDistribution: [
        { quantity: 6, orderCount: 1 },
        { quantity: 4, orderCount: 3 },
        { quantity: 1, orderCount: 2 },
      ],
    });
  });

  it("combines separate lines of the same article within a customer's order", () => {
    const rows = buildPickupPrintRows([
      { id: "a", lineGroupKey: "order:1", quantity: 2,
        orderItem: { id: "item-a", sku: "CHAIR", name: "Stolica", qty: 8 } },
      { id: "b", lineGroupKey: "order:1", quantity: 4,
        orderItem: { id: "item-b", sku: "CHAIR", name: "Stolica", qty: 4 } },
      { id: "c", lineGroupKey: "order:2", quantity: null,
        orderItem: { id: "item-c", sku: "CHAIR", name: "Stolica", qty: 6 } },
    ]);
    expect(rows[0]).toMatchObject({
      quantity: 12,
      quantityDistribution: [{ quantity: 6, orderCount: 2 }],
    });
  });
});

it("sorts categories first and names second, keeps colors, and excludes deferred carton contents", () => {
  const make = (id: string, name: string, category: string, packedQuantity = 1) => ({
    id, lineGroupKey: "order:1", quantity: 3, packedQuantity,
    orderItem: { id, sku: id, name, qty: 3, categoryName: category, color1: "Siva", color2: "Crna" },
  });
  const a = make("999", "Alfa", "Stolice", 2);
  const rows = buildPickupPrintRows([
    make("001", "Zebra", "Stolice"), a,
    { ...a, id: "remainder", packedQuantity: 1, deferredAt: new Date() },
    make("500", "Zulu", "Lampe"),
  ]);
  expect(rows.map(row => row.name)).toEqual(["Zulu", "Alfa", "Zebra"]);
  expect(rows[1]).toMatchObject({ color: "Siva / Crna", quantity: 2, packageCount: 1,
    quantityDistribution: [{ quantity: 2, orderCount: 1 }] });
});

it("counts a full box and an odd remainder as three units for one customer", () => {
  const orderItem = { id: "item", sku: "100", name: "Stolica", qty: 3 };
  const rows = buildPickupPrintRows([2, 1].map((packedQuantity, i) => ({
    id: String(i), lineGroupKey: "order:1", quantity: 3, packedQuantity, orderItem,
  })));
  expect(rows[0]).toMatchObject({ quantity: 3, packageCount: 2,
    quantityDistribution: [{ quantity: 3, orderCount: 1 }] });
});
