import type { Reclamation } from "@prisma/client";

export const RECLAMATION_WAREHOUSE_STATUS_LABELS: Record<string, string> = {
  NOT_REQUESTED: "Nije zatraženo",
  REQUESTED: "Zatraženo",
  PREPARING: "U pripremi",
  READY: "Spremno",
  HANDED_OVER: "Predato kuriru",
  CANCELLED: "Otkazano",
  AWAITING_RETURN: "Čeka prijem u magacin",
  PARTIALLY_RECEIVED: "Delimično primljeno u magacin",
  DELIVERED: "Primljeno u magacin",
};

export type ReclamationWarehouseClaim = Pick<
  Reclamation,
  "id" | "orderId" | "quantity" | "request" | "resolution" | "warehouseStatus"
>;

export function isReclamationMoneyReturn(claim: ReclamationWarehouseClaim) {
  return claim.resolution === "POVRAT_NOVCA"
    || (!claim.resolution && claim.request === "POVRACAJ_NOVCA");
}

/** A posted inventory receipt proves intake; preparation and courier status do not. */
export function reclamationWarehouseStatus(claim: ReclamationWarehouseClaim, receivedQty: number) {
  if (!isReclamationMoneyReturn(claim)) return claim.warehouseStatus;
  if (claim.quantity > 0 && receivedQty >= claim.quantity) return "DELIVERED";
  if (receivedQty > 0) return "PARTIALLY_RECEIVED";
  if (claim.warehouseStatus === "CANCELLED") return claim.warehouseStatus;
  return "AWAITING_RETURN";
}
