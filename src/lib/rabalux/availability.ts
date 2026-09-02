export const RABALUX_SUPPLIER_SAFETY_STOCK = 1;
/** Minimum Serbia XLSX quantity required for web purchasing; 1 and below stay hidden. */
export const RABALUX_PUBLIC_STOCK_THRESHOLD = 2;
/** Customer-facing delivery promise for supplier-stock Rabalux items. */
export const RABALUX_DELIVERY_WINDOW = { min: 1, max: 2 } as const;

export type StockAvailabilitySource = "DC" | "SUPPLIER" | "MIXED" | "NONE";

export type RabaluxSupplierStockStatus =
  | "AVAILABLE"
  | "BELOW_THRESHOLD"
  | "MISSING_OBSERVATION"
  | "PENDING_APPROVAL"
  | "DISABLED";

export const RABALUX_SUPPLIER_STOCK_STATUS_LABELS: Record<
  RabaluxSupplierStockStatus,
  string
> = {
  AVAILABLE: "Dostupno",
  BELOW_THRESHOLD: "Ispod praga",
  MISSING_OBSERVATION: "Nije učitan lager",
  PENDING_APPROVAL: "Čeka odobrenje",
  DISABLED: "Integracija isključena",
};

/** The latest successfully applied Serbia XLSX remains authoritative until replaced. */
export function hasRabaluxStockObservation(
  syncedAt: Date | string | null | undefined,
) {
  if (!syncedAt) return false;
  const timestamp = syncedAt instanceof Date ? syncedAt : new Date(syncedAt);
  return Number.isFinite(timestamp.getTime());
}

export function resolveRabaluxSupplierStock(input: {
  supplierStock?: number | null;
  supplierReservedStock?: number | null;
  lastSupplierStockSyncAt?: Date | string | null;
  supplierOperational: boolean;
  supplierApproved: boolean;
}) {
  const rawStock = nonnegativeInt(input.supplierStock ?? 0);
  const reservedStock = nonnegativeInt(input.supplierReservedStock ?? 0);
  const observed = hasRabaluxStockObservation(input.lastSupplierStockSyncAt);
  const aboveThreshold = rawStock >= RABALUX_PUBLIC_STOCK_THRESHOLD;
  const eligible =
    input.supplierOperational &&
    input.supplierApproved &&
    observed &&
    aboveThreshold;
  const netAfterSafety = Math.max(
    rawStock - reservedStock - RABALUX_SUPPLIER_SAFETY_STOCK,
    0,
  );
  const status: RabaluxSupplierStockStatus = !input.supplierOperational
    ? "DISABLED"
    : !observed
      ? "MISSING_OBSERVATION"
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
    observed,
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
}) {
  const warehouseStock = nonnegativeInt(input.warehouseStock);
  const supplier = resolveRabaluxSupplierStock(input);
  // Rabalux web purchasing follows the weekly Serbia report exclusively.
  // ERP/DC quantities remain observable for administration, but they cannot
  // make a row with 0-1 supplier units purchasable.
  const supplierAvailable = supplier.sellableStock;
  const sellableStock = supplierAvailable;
  const source: StockAvailabilitySource =
    supplierAvailable > 0 ? "SUPPLIER" : "NONE";
  return {
    warehouseAvailable: warehouseStock,
    supplierAvailable,
    sellableStock,
    source,
    supplierObserved: supplier.observed,
    supplierEligible: supplier.eligible,
  };
}

function nonnegativeInt(value: number) {
  return Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0;
}
