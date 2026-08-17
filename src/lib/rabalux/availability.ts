/** Weekly Serbia XLSX is accepted for seven days plus a one-day delivery grace. */
export const RABALUX_STOCK_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1_000;
export const RABALUX_SUPPLIER_SAFETY_STOCK = 1;
/** Minimum Serbia XLSX quantity required for web purchasing. */
export const RABALUX_PUBLIC_STOCK_THRESHOLD = 10;
/** Customer-facing delivery promise for supplier-stock Rabalux items. */
export const RABALUX_DELIVERY_WINDOW = { min: 5, max: 8 } as const;

export type StockAvailabilitySource = "DC" | "SUPPLIER" | "MIXED" | "NONE";

export type RabaluxSupplierStockStatus =
  | "AVAILABLE"
  | "BELOW_THRESHOLD"
  | "STALE"
  | "PENDING_APPROVAL"
  | "DISABLED";

export const RABALUX_SUPPLIER_STOCK_STATUS_LABELS: Record<
  RabaluxSupplierStockStatus,
  string
> = {
  AVAILABLE: "Dostupno",
  BELOW_THRESHOLD: "Ispod praga",
  STALE: "Zastarelo",
  PENDING_APPROVAL: "Čeka odobrenje",
  DISABLED: "Integracija isključena",
};

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

export function resolveRabaluxSupplierStock(input: {
  supplierStock?: number | null;
  supplierReservedStock?: number | null;
  lastSupplierStockSyncAt?: Date | string | null;
  supplierOperational: boolean;
  supplierApproved: boolean;
  now?: Date;
}) {
  const rawStock = nonnegativeInt(input.supplierStock ?? 0);
  const reservedStock = nonnegativeInt(input.supplierReservedStock ?? 0);
  const fresh = isRabaluxStockFresh(input.lastSupplierStockSyncAt, input.now);
  const aboveThreshold = rawStock >= RABALUX_PUBLIC_STOCK_THRESHOLD;
  const eligible =
    input.supplierOperational && input.supplierApproved && fresh && aboveThreshold;
  const netAfterSafety = Math.max(
    rawStock - reservedStock - RABALUX_SUPPLIER_SAFETY_STOCK,
    0,
  );
  const status: RabaluxSupplierStockStatus = !input.supplierOperational
    ? "DISABLED"
    : !fresh
      ? "STALE"
      : !input.supplierApproved
        ? "PENDING_APPROVAL"
        : !aboveThreshold
          ? "BELOW_THRESHOLD"
          : "AVAILABLE";

  return {
    rawStock,
    reservedStock,
    safetyStock: RABALUX_SUPPLIER_SAFETY_STOCK,
    netAfterSafety,
    sellableStock: eligible ? netAfterSafety : 0,
    fresh,
    aboveThreshold,
    eligible,
    status,
  };
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
  const supplier = resolveRabaluxSupplierStock(input);
  // Rabalux web purchasing follows the weekly Serbia report exclusively.
  // ERP/DC quantities remain observable for administration, but they cannot
  // make a row with 0-9 supplier units purchasable.
  const supplierAvailable = supplier.sellableStock;
  const sellableStock = supplierAvailable;
  const source: StockAvailabilitySource =
    supplierAvailable > 0 ? "SUPPLIER" : "NONE";
  return {
    warehouseAvailable: warehouseStock,
    supplierAvailable,
    sellableStock,
    source,
    supplierFresh: supplier.fresh,
    supplierEligible: supplier.eligible,
  };
}

function nonnegativeInt(value: number) {
  return Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}
