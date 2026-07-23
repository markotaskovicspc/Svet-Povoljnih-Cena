import {
  CHANNEL_SAFETY_STOCK,
  resolveChannelAvailability,
} from "@/lib/channel-availability";

export type ArticleWarehouseStock = {
  warehouseId: string;
  warehouseName: string;
  isDefault: boolean;
  qty: number;
};

export type ArticleOrderReservation = {
  warehouseId: string | null;
  qty: number;
};

export type ArticlePartnerReservation = {
  warehouseId: string | null;
  qty: number;
};

export type ArticleStockInput = {
  aggregateStock: number;
  warehouses: ArticleWarehouseStock[];
  orderReservations: ArticleOrderReservation[];
  partnerReservations: ArticlePartnerReservation[];
  manualWeb: boolean;
  manualWholesale: boolean;
  manualExport: boolean;
  selectedWarehouseId?: string | null;
};

export type ArticleWarehouseBalance = {
  warehouseId: string;
  warehouseName: string;
  isDefault: boolean;
  physical: number;
  reserved: number;
  available: number;
};

export function computeArticleStock(input: ArticleStockInput) {
  const defaultWarehouse =
    input.warehouses.find((warehouse) => warehouse.isDefault) ??
    input.warehouses[0] ??
    null;
  const orderByWarehouse = new Map<string, number>();
  const partnerByWarehouse = new Map<string, number>();
  const fallbackWarehouseId = defaultWarehouse?.warehouseId ?? "";

  for (const reservation of input.orderReservations) {
    const warehouseId = reservation.warehouseId ?? fallbackWarehouseId;
    if (!warehouseId) continue;
    orderByWarehouse.set(
      warehouseId,
      (orderByWarehouse.get(warehouseId) ?? 0) + reservation.qty,
    );
  }
  for (const reservation of input.partnerReservations) {
    const warehouseId = reservation.warehouseId ?? fallbackWarehouseId;
    if (!warehouseId) continue;
    partnerByWarehouse.set(
      warehouseId,
      (partnerByWarehouse.get(warehouseId) ?? 0) + reservation.qty,
    );
  }

  const balances: ArticleWarehouseBalance[] = input.warehouses.map((warehouse) => {
    const orderReserved = orderByWarehouse.get(warehouse.warehouseId) ?? 0;
    const partnerReserved = partnerByWarehouse.get(warehouse.warehouseId) ?? 0;
    return {
      warehouseId: warehouse.warehouseId,
      warehouseName: warehouse.warehouseName,
      isDefault: warehouse.isDefault,
      // Checkout reservations decrement WarehouseStock. Add them back only for
      // the client's physical-vs-reserved presentation.
      physical: warehouse.qty + orderReserved,
      reserved: orderReserved + partnerReserved,
      available: Math.max(warehouse.qty - partnerReserved, 0),
    };
  });

  const hasWarehouseRows = balances.length > 0;
  const physicalTotal = hasWarehouseRows
    ? balances.reduce((sum, warehouse) => sum + warehouse.physical, 0)
    : input.aggregateStock;
  const reservedTotal = balances.reduce(
    (sum, warehouse) => sum + warehouse.reserved,
    0,
  );
  const availableTotal = hasWarehouseRows
    ? balances.reduce((sum, warehouse) => sum + warehouse.available, 0)
    : Math.max(input.aggregateStock, 0);
  const selected =
    balances.find(
      (warehouse) => warehouse.warehouseId === input.selectedWarehouseId,
    ) ?? null;
  const defaultBalance =
    balances.find((warehouse) => warehouse.isDefault) ?? balances[0] ?? null;
  const contextual = selected ?? {
    warehouseId: "",
    warehouseName: "Svi magacini",
    isDefault: false,
    physical: physicalTotal,
    reserved: reservedTotal,
    available: availableTotal,
  };
  const dcAvailable = defaultBalance?.available ?? Math.max(input.aggregateStock, 0);
  const channels = resolveChannelAvailability({
    physical: dcAvailable,
    manualWeb: input.manualWeb,
    manualWholesale: input.manualWholesale,
    manualExport: input.manualExport,
  });

  return {
    warehouses: balances,
    physicalTotal,
    reservedTotal,
    availableTotal,
    contextual,
    dc: defaultBalance,
    dcAvailable,
    channels: {
      webAuto: dcAvailable > CHANNEL_SAFETY_STOCK.web,
      wholesaleAuto: dcAvailable > CHANNEL_SAFETY_STOCK.wholesale,
      exportAuto: dcAvailable > CHANNEL_SAFETY_STOCK.export,
      web: channels.web,
      wholesale: channels.wholesale,
      export: channels.export,
    },
  };
}
