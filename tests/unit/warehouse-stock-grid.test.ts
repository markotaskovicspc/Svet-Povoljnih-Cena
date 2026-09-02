import { describe, expect, it } from "vitest";
import { filterAndSortGridRows } from "@/lib/admin/grid-query";
import {
  buildWarehouseStockGridRows,
  WAREHOUSE_GRID_INCOMING_ORDER_STATUSES,
  type WarehouseStockGridProduct,
} from "@/lib/admin/warehouse-stock-grid";

const warehouse = {
  id: "dc",
  name: "DC",
  isDefault: true,
  active: true,
};

function product(
  id: string,
  incomingStock = 0,
): WarehouseStockGridProduct {
  return {
    id,
    sku: id.toUpperCase(),
    name: `Artikal ${id}`,
    stock: 0,
    incomingStock,
    cogs: 250,
    availableWebManual: true,
    availableWholesaleManual: true,
    availableExportManual: true,
    partnerReservations: [],
    orderItems: [],
  };
}

describe("DC warehouse incoming rows", () => {
  it("values stock from physical quantity, not available quantity", () => {
    const reserved = product("reserved");
    reserved.orderItems = [
      {
        warehouseId: "dc",
        warehouseReservedQty: 3,
        stockMovements: [],
      },
    ];
    const [row] = buildWarehouseStockGridRows({
      stocks: [{ id: "stock-row", qty: 10, warehouse, product: reserved }],
      incomingOrderLines: [],
      productsWithStoredIncoming: [],
      defaultWarehouse: warehouse,
    });

    expect(row.values).toMatchObject({
      physical: 10,
      reserved: 3,
      available: 7,
      cogs: 250,
      cogsValue: 2_500,
    });
  });

  it("treats every non-final purchase-order status as incoming", () => {
    expect(WAREHOUSE_GRID_INCOMING_ORDER_STATUSES).toEqual([
      "DRAFT",
      "SENT",
      "CONFIRMED",
    ]);
  });

  it("includes and sorts an incoming-only product without a stock row", () => {
    const stocked = product("stocked");
    const incomingOnly = product("incoming-only");
    const storedIncomingOnly = product("stored-incoming-only", 10);
    const rows = buildWarehouseStockGridRows({
      stocks: [
        {
          id: "stock-row",
          qty: 4,
          warehouse,
          product: stocked,
        },
      ],
      incomingOrderLines: [
        {
          qty: 120,
          receivedQty: 20,
          warehouse: null,
          product: incomingOnly,
        },
      ],
      productsWithStoredIncoming: [storedIncomingOnly],
      defaultWarehouse: warehouse,
    });

    expect(rows.map((row) => row.id)).toEqual([
      "stock-row",
      "incoming:dc:incoming-only",
      "incoming:dc:stored-incoming-only",
    ]);
    expect(
      filterAndSortGridRows(rows, ["incoming"], "", [], [
        { columnKey: "incoming", direction: "desc" },
      ]).map((row) => [row.values.sku, row.values.incoming]),
    ).toEqual([
      ["INCOMING-ONLY", 100],
      ["STORED-INCOMING-ONLY", 10],
      ["STOCKED", 0],
    ]);
  });

  it("aggregates order lines without double-counting stored incoming", () => {
    const incoming = product("incoming", 12);
    const [row] = buildWarehouseStockGridRows({
      stocks: [
        {
          id: "stock-row",
          qty: 0,
          warehouse,
          product: incoming,
        },
      ],
      incomingOrderLines: [
        { qty: 10, receivedQty: 2, warehouse, product: incoming },
        { qty: 4, receivedQty: 0, warehouse, product: incoming },
      ],
      productsWithStoredIncoming: [incoming],
      defaultWarehouse: warehouse,
    });

    expect(row.values.incoming).toBe(12);
  });

  it("subtracts partial receipts and ignores fully received or over-received lines", () => {
    const partial = product("partial");
    const complete = product("complete");
    const overReceived = product("over-received");
    const rows = buildWarehouseStockGridRows({
      stocks: [
        { id: "partial", qty: 0, warehouse, product: partial },
        { id: "complete", qty: 0, warehouse, product: complete },
        { id: "over", qty: 0, warehouse, product: overReceived },
      ],
      incomingOrderLines: [
        { qty: 20, receivedQty: 7, warehouse, product: partial },
        { qty: 20, receivedQty: 20, warehouse, product: complete },
        { qty: 20, receivedQty: 25, warehouse, product: overReceived },
      ],
      productsWithStoredIncoming: [],
      defaultWarehouse: warehouse,
    });

    expect(rows.map((row) => row.values.incoming)).toEqual([13, 0, 0]);
  });

  it("groups incoming quantities independently by receiving warehouse", () => {
    const secondWarehouse = {
      id: "nis",
      name: "Niš",
      isDefault: false,
      active: true,
    };
    const incoming = product("multi-warehouse");
    const rows = buildWarehouseStockGridRows({
      stocks: [
        { id: "dc-row", qty: 0, warehouse, product: incoming },
        { id: "nis-row", qty: 0, warehouse: secondWarehouse, product: incoming },
      ],
      incomingOrderLines: [
        { qty: 30, receivedQty: 0, warehouse, product: incoming },
        {
          qty: 20,
          receivedQty: 5,
          warehouse: secondWarehouse,
          product: incoming,
        },
      ],
      productsWithStoredIncoming: [],
      defaultWarehouse: warehouse,
    });

    expect(
      rows.map((row) => [row.values.warehouse, row.values.incoming]),
    ).toEqual([
      ["DC", 30],
      ["Niš", 15],
    ]);
  });

  it("falls back to DC for a missing or inactive receiving warehouse", () => {
    const inactiveWarehouse = {
      id: "inactive",
      name: "Neaktivan",
      isDefault: false,
      active: false,
    };
    const incoming = product("fallback");
    const rows = buildWarehouseStockGridRows({
      stocks: [{ id: "dc-row", qty: 0, warehouse, product: incoming }],
      incomingOrderLines: [
        { qty: 4, receivedQty: 0, warehouse: null, product: incoming },
        {
          qty: 6,
          receivedQty: 0,
          warehouse: inactiveWarehouse,
          product: incoming,
        },
      ],
      productsWithStoredIncoming: [],
      defaultWarehouse: warehouse,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].values.incoming).toBe(10);
  });

  it("does not invent a warehouse row when no active default exists", () => {
    const incoming = product("orphan");
    expect(
      buildWarehouseStockGridRows({
        stocks: [],
        incomingOrderLines: [
          { qty: 10, receivedQty: 0, warehouse: null, product: incoming },
        ],
        productsWithStoredIncoming: [product("stored-orphan", 5)],
        defaultWarehouse: null,
      }),
    ).toEqual([]);
  });
});
