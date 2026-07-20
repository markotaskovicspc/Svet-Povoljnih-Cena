export type StockAllocation = {
  warehouseQty: number;
  supplierQty: number;
};

export function effectiveSellableStock(input: {
  warehouseStock: number;
  supplierStock?: number | null;
  supplierReservedStock?: number | null;
}) {
  const warehouse = nonnegativeInt(input.warehouseStock);
  const supplier = nonnegativeInt(input.supplierStock ?? 0);
  const reserved = nonnegativeInt(input.supplierReservedStock ?? 0);
  return warehouse + Math.max(supplier - reserved, 0);
}

export function allocateStock(
  requestedQty: number,
  input: {
    warehouseStock: number;
    supplierStock?: number | null;
    supplierReservedStock?: number | null;
  },
): StockAllocation | null {
  if (!Number.isInteger(requestedQty) || requestedQty <= 0) return null;
  const warehouseAvailable = nonnegativeInt(input.warehouseStock);
  const supplierAvailable = Math.max(
    nonnegativeInt(input.supplierStock ?? 0) -
      nonnegativeInt(input.supplierReservedStock ?? 0),
    0,
  );
  if (warehouseAvailable + supplierAvailable < requestedQty) return null;
  const warehouseQty = Math.min(requestedQty, warehouseAvailable);
  return {
    warehouseQty,
    supplierQty: requestedQty - warehouseQty,
  };
}

function nonnegativeInt(value: number) {
  return Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}
