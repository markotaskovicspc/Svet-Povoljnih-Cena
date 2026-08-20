import { RABALUX_PUBLIC_STOCK_THRESHOLD } from "./availability";

export const RABALUX_WEEKLY_STOCK_SOURCE_TYPE = "RABALUX_WEEKLY_XLSX";

export function isCommittedRabaluxWeeklyStockMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  const values = metadata as Record<string, unknown>;
  return (
    values.sourceType === RABALUX_WEEKLY_STOCK_SOURCE_TYPE &&
    values.failedBeforeStockCommit !== true
  );
}

export function resolveRabaluxWeeklyStockPolicy(input: {
  closingStock: number;
  supplierApprovalStatus: string | null;
  articleStatus: string;
  hasCategory: boolean;
  hasReadyImage: boolean;
  hasActiveRetailPrice: boolean;
}) {
  const hasPublicationData =
    input.supplierApprovalStatus === "APPROVED" &&
    input.articleStatus !== "ARH" &&
    input.hasCategory &&
    input.hasReadyImage &&
    input.hasActiveRetailPrice;
  const supplierPassesThreshold =
    input.closingStock >= RABALUX_PUBLIC_STOCK_THRESHOLD;
  // The complete weekly XLSX is authoritative for Serbia: only a positive
  // closing balance is present in Serbia and may stay published. Quantities
  // 1-2 remain visible but unavailable; 3+ may be purchased.
  const isActive = hasPublicationData && input.closingStock > 0;

  return {
    hasPublicationData,
    supplierPassesThreshold,
    isActive,
    availableWebAuto: isActive && supplierPassesThreshold,
  };
}

export function shouldReconcileMissingCatalogProducts(
  weeklySnapshotActive: boolean,
) {
  return !weeklySnapshotActive;
}
