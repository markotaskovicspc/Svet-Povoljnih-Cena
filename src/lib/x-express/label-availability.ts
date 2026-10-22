import type { Prisma } from "@prisma/client";

/** A later delivery failure does not invalidate an already accepted label. */
export function isXExpressLabelAvailable(shipment: {
  status: string;
  trackingNo: string | null;
  providerShipmentId: string | null;
}) {
  return Boolean(shipment.trackingNo) &&
    (shipment.status !== "FAILED" || Boolean(shipment.providerShipmentId));
}

export function usableXExpressLabelWhere(): Prisma.ShipmentWhereInput {
  return {
    trackingNo: { not: null },
    OR: [
      { status: { not: "FAILED" } },
      { providerShipmentId: { not: null } },
    ],
  };
}
