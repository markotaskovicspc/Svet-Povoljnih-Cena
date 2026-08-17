import { RABALUX_PUBLIC_STOCK_THRESHOLD } from "./availability";

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
  // A row in the complete weekly XLSX is the publication allow-list. Stock
  // controls purchasing only: 0-9 stays visible, while 10+ may be purchased.
  const isActive = hasPublicationData;

  return {
    hasPublicationData,
    supplierPassesThreshold,
    isActive,
    availableWebAuto: isActive && supplierPassesThreshold,
  };
}
