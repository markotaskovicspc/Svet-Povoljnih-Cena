import type { ErpRow } from "@/lib/admin/erp";
import { resolveChannelAvailability } from "@/lib/channel-availability";
import { resolveStoredWarehouseBalance } from "@/lib/reservation-stock";
import { resolvePickingPositions, type PickingPosition } from "./picking-positions";
import { incomingWarehouseKey, summarizePurchaseOrderIncoming } from "./purchase-order-incoming";

export type WarehouseStockGridWarehouse = {
  id: string;
  name: string;
  isDefault: boolean;
  active: boolean;
};

export type WarehouseStockGridProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  supplierId?: string | null;
  supplier: { name: string } | null;
  shortDescription: string | null;
  shortName: string | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  stock: number;
  incomingStock: number;
  cogs: number | { toNumber(): number } | null;
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
  deliveryDate?: Date | null;
  status?: string;
  warehouse: WarehouseStockGridWarehouse | null;
  product: WarehouseStockGridProduct;
};

function createWarehouseStockGridRow(input: {
  id: string;
  storedQty: number;
  incoming: number;
  firstIncomingDate: string | null;
  firstIncomingQty: number | null;
  warehouse: WarehouseStockGridWarehouse;
  product: WarehouseStockGridProduct;
  pickingPositions: PickingPosition[];
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
  const unitCogs =
    input.product.cogs === null
      ? null
      : typeof input.product.cogs === "number"
        ? input.product.cogs
        : input.product.cogs.toNumber();
  const channels = resolveChannelAvailability({
    physical: available,
    manualWeb: input.product.availableWebManual,
    manualWholesale: input.product.availableWholesaleManual,
    manualExport: input.product.availableExportManual,
  });
  const positions = resolvePickingPositions(input.pickingPositions, {
    warehouseId: input.warehouse.id,
    sku: input.product.sku,
    supplierId: input.product.supplierId,
  });
  return {
    id: input.id,
    values: {
      warehouse: input.warehouse.name,
      sku: input.product.sku,
      barcode: input.product.barcode ?? null,
      pickingPosition: positions.map(position => position.number).join(", ") || null,
      product: input.product.name,
      supplier: input.product.supplier?.name ?? null,
      shortDescription: input.product.shortDescription,
      shortName: input.product.shortName,
      color1: input.product.colorPrimary,
      color2: input.product.colorSecondary,
      physical,
      reserved,
      available,
      incoming: input.incoming,
      firstIncomingDate: input.firstIncomingDate,
      firstIncomingQty: input.firstIncomingQty,
      cogs: unitCogs,
      cogsValue:
        unitCogs === null
          ? null
          : Math.round(physical * unitCogs * 100) / 100,
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
  pickingPositions?: PickingPosition[];
}) {
  const summaries = summarizePurchaseOrderIncoming({
    lines: input.incomingOrderLines.map(line => ({
      productId: line.product.id, warehouseId: line.warehouse?.id ?? null,
      warehouseActive: line.warehouse?.active,
      qty: line.qty, receivedQty: line.receivedQty, deliveryDate: line.deliveryDate, status: line.status,
    })),
    storedIncoming: input.productsWithStoredIncoming.map(product => ({ productId: product.id, incomingStock: product.incomingStock })),
    defaultWarehouseId: input.defaultWarehouse?.id ?? null,
  });
  const products = new Map([
    ...input.stocks.map(stock => [stock.product.id, stock.product] as const),
    ...input.incomingOrderLines.map(line => [line.product.id, line.product] as const),
    ...input.productsWithStoredIncoming.map(product => [product.id, product] as const),
  ]);
  const warehouses = new Map([
    ...input.stocks.map(stock => [stock.warehouse.id, stock.warehouse] as const),
    ...input.incomingOrderLines.flatMap(line => line.warehouse ? [[line.warehouse.id, line.warehouse] as const] : []),
    ...(input.defaultWarehouse ? [[input.defaultWarehouse.id, input.defaultWarehouse] as const] : []),
  ]);

  const consumedIncomingKeys = new Set<string>();
  const rows = input.stocks.map((stock) => {
    const key = incomingWarehouseKey(stock.product.id, stock.warehouse.id);
    const summary = summaries.get(key);
    consumedIncomingKeys.add(key);
    return createWarehouseStockGridRow({
      id: stock.id,
      storedQty: stock.qty,
      incoming: summary?.incoming ?? 0,
      firstIncomingDate: summary?.firstIncomingDate ?? null,
      firstIncomingQty: summary?.firstIncomingQty ?? null,
      warehouse: stock.warehouse,
      product: stock.product,
      pickingPositions: input.pickingPositions ?? [],
    });
  });

  for (const [key, summary] of summaries) {
    if (consumedIncomingKeys.has(key)) continue;
    const warehouse = warehouses.get(summary.warehouseId);
    const product = products.get(summary.productId);
    if (!warehouse || !product) continue;
    rows.push(
      createWarehouseStockGridRow({
        id: `incoming:${warehouse.id}:${product.id}`,
        storedQty: warehouse.isDefault ? product.stock : 0,
        incoming: summary.incoming,
        firstIncomingDate: summary.firstIncomingDate,
        firstIncomingQty: summary.firstIncomingQty,
        warehouse,
        product,
        pickingPositions: input.pickingPositions ?? [],
      }),
    );
  }

  return rows;
}
