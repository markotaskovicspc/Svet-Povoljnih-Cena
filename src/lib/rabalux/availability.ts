import { effectiveSellableStock } from "./allocation";

export const RABALUX_STOCK_MAX_AGE_MS = 30 * 60 * 1_000;
export const RABALUX_SUPPLIER_SAFETY_STOCK = 1;

export type StockAvailabilitySource = "DC" | "SUPPLIER" | "MIXED" | "NONE";

export function isRabaluxStockFresh(
  syncedAt: Date | string | null | undefined,
  now = new Date(),
) {
  if (!syncedAt) return false;
  const timestamp = syncedAt instanceof Date ? syncedAt : new Date(syncedAt);
  const time = timestamp.getTime();
  if (!Number.isFinite(time)) return false;
  const age = now.getTime() - time;
  return age >= -5 * 60 * 1_000 && age <= RABALUX_STOCK_MAX_AGE_MS;
}

export function rabaluxStockFreshAfter(now = new Date()) {
  return new Date(now.getTime() - RABALUX_STOCK_MAX_AGE_MS);
}

export function resolveRabaluxAvailability(input: {
  warehouseStock: number;
  supplierStock?: number | null;
  supplierReservedStock?: number | null;
  lastSupplierStockSyncAt?: Date | string | null;
  supplierOperational: boolean;
  supplierApproved: boolean;
  now?: Date;
}) {
  const warehouseStock = nonnegativeInt(input.warehouseStock);
  const supplierEligible =
    input.supplierOperational &&
    input.supplierApproved &&
    isRabaluxStockFresh(input.lastSupplierStockSyncAt, input.now);
  const sellableStock = effectiveSellableStock({
    warehouseStock,
    supplierStock: supplierEligible ? input.supplierStock : 0,
    supplierReservedStock: supplierEligible ? input.supplierReservedStock : 0,
    supplierSafetyStock: supplierEligible ? RABALUX_SUPPLIER_SAFETY_STOCK : 0,
  });
  const supplierAvailable = Math.max(sellableStock - warehouseStock, 0);
  const source: StockAvailabilitySource =
    warehouseStock > 0 && supplierAvailable > 0
      ? "MIXED"
      : warehouseStock > 0
        ? "DC"
        : supplierAvailable > 0
          ? "SUPPLIER"
          : "NONE";
  return {
    warehouseAvailable: warehouseStock,
    supplierAvailable,
    sellableStock,
    source,
    supplierFresh: supplierEligible,
  };
}

function nonnegativeInt(value: number) {
  return Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}
