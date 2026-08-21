import type { ErpRow } from "@/lib/admin/erp";
import { resolveChannelAvailability } from "@/lib/channel-availability";
import { resolveStoredWarehouseBalance } from "@/lib/reservation-stock";

export const WAREHOUSE_GRID_INCOMING_ORDER_STATUSES = [
  "DRAFT",
  "SENT",
  "CONFIRMED",
] as const;

export type WarehouseStockGridWarehouse = {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
};

export type WarehouseStockGridProduct = {
  id: string;
  sku: string;
  name: string;
  stock: number;
  incomingStock: number;
  availableWebManual: boolean;
  availableWholesaleManual: boolean;
  availableExportManual: boolean;
  partnerReservations: Array<{
    qty: number;
    warehouseId: string | null;
  }>;
  orderItems: Array<{
    warehouseId: string | null;
    warehouseReservedQty: number;
    stockMovements: Array<{ qty: number }>;
  }>;
};

export type StoredWarehouseStockGridInput = {
  id: string;
  qty: number;
  warehouse: WarehouseStockGridWarehouse;
  product: WarehouseStockGridProduct;
};

export type IncomingPurchaseOrderGridInput = {
  qty: number;
  receivedQty: number;
  warehouse: WarehouseStockGridWarehouse | null;
  product: WarehouseStockGridProduct;
};

type IncomingGridBalance = {
  incoming: number;
  warehouse: WarehouseStockGridWarehouse;
  product: WarehouseStockGridProduct;
};

function productWarehouseKey(productId: string, warehouseId: string) {
  return `${productId}:${warehouseId}`;
}

function createWarehouseStockGridRow(input: {
  id: string;
  storedQty: number;
  incoming: number;
  warehouse: WarehouseStockGridWarehouse;
  product: WarehouseStockGridProduct;
}): ErpRow {
  const belongsToWarehouse = (warehouseId: string | null) =>
    warehouseId === input.warehouse.id ||
    (warehouseId === null && input.warehouse.isDefault);
  const partnerReserved = input.product.partnerReservations
    .filter((item) => belongsToWarehouse(item.warehouseId))
    .reduce((sum, item) => sum + item.qty, 0);
  const balance = resolveStoredWarehouseBalance({
    storedQty: input.storedQty,
    orderReservations: input.product.orderItems
      .filter((item) => belongsToWarehouse(item.warehouseId))
      .map((item) => ({
        qty: item.warehouseReservedQty,
        debited:
          item.stockMovements.reduce(
            (sum, movement) => sum + movement.qty,
            0,
          ) < 0,
      })),
    partnerReserved,
  });
  const { physical, reserved, available } = balance;
  const channels = resolveChannelAvailability({
    physical: available,
    manualWeb: input.product.availableWebManual,
    manualWholesale: input.product.availableWholesaleManual,
    manualExport: input.product.availableExportManual,
  });
  return {
    id: input.id,
    values: {
      warehouse: input.warehouse.name,
      sku: input.product.sku,
      product: input.product.name,
      physical,
      reserved,
      available,
      incoming: input.incoming,
      web: channels.web,
      wholesale: channels.wholesale,
      export: channels.export,
    },
  };
}

/**
 * Builds the DC grid from both persisted balances and open purchase orders.
 * An ordered product may not have a WarehouseStock row until its first receipt,
 * so open-order-only rows must be synthesized before the API sorts the data.
 */
export function buildWarehouseStockGridRows(input: {
  stocks: StoredWarehouseStockGridInput[];
  incomingOrderLines: IncomingPurchaseOrderGridInput[];
  productsWithStoredIncoming: WarehouseStockGridProduct[];
  defaultWarehouse: WarehouseStockGridWarehouse | null;
}) {
  const incomingByProductWarehouse = new Map<string, IncomingGridBalance>();
  const derivedIncomingByProduct = new Map<string, number>();

  for (const line of input.incomingOrderLines) {
    const incoming = Math.max(line.qty - line.receivedQty, 0);
    if (incoming === 0) continue;
    const warehouse = line.warehouse?.active
      ? line.warehouse
      : input.defaultWarehouse;
    if (!warehouse) continue;
    const key = productWarehouseKey(line.product.id, warehouse.id);
    const current = incomingByProductWarehouse.get(key);
    incomingByProductWarehouse.set(key, {
      incoming: (current?.incoming ?? 0) + incoming,
      warehouse,
      product: line.product,
    });
    derivedIncomingByProduct.set(
      line.product.id,
      (derivedIncomingByProduct.get(line.product.id) ?? 0) + incoming,
    );
  }

  // Preserve any separately stored incoming quantity without double-counting
  // the part already derived from purchase-order lines.
  if (input.defaultWarehouse) {
    for (const product of input.productsWithStoredIncoming) {
      const extraIncoming = Math.max(
        product.incomingStock -
          (derivedIncomingByProduct.get(product.id) ?? 0),
        0,
      );
      if (extraIncoming === 0) continue;
      const key = productWarehouseKey(product.id, input.defaultWarehouse.id);
      const current = incomingByProductWarehouse.get(key);
      incomingByProductWarehouse.set(key, {
        incoming: (current?.incoming ?? 0) + extraIncoming,
        warehouse: input.defaultWarehouse,
        product,
      });
    }
  }

  const consumedIncomingKeys = new Set<string>();
  const rows = input.stocks.map((stock) => {
    const key = productWarehouseKey(stock.product.id, stock.warehouse.id);
    const incoming = incomingByProductWarehouse.get(key)?.incoming ?? 0;
    consumedIncomingKeys.add(key);
    return createWarehouseStockGridRow({
      id: stock.id,
      storedQty: stock.qty,
      incoming,
      warehouse: stock.warehouse,
      product: stock.product,
    });
  });

  for (const [key, balance] of incomingByProductWarehouse) {
    if (consumedIncomingKeys.has(key)) continue;
    rows.push(
      createWarehouseStockGridRow({
        id: `incoming:${balance.warehouse.id}:${balance.product.id}`,
        storedQty: balance.warehouse.isDefault ? balance.product.stock : 0,
        incoming: balance.incoming,
        warehouse: balance.warehouse,
        product: balance.product,
      }),
    );
  }

  return rows;
}
