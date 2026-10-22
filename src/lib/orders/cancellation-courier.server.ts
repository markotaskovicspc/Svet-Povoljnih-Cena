import "server-only";

import type { Prisma } from "@prisma/client";
import { OrderCancellationError } from "./cancellation";

/** Call while holding the order lock, shared with pickup label preparation. */
export async function assertOrderCancellationBeforeCourier(
  tx: Pick<Prisma.TransactionClient, "pickupBatchLine" | "shipment">,
  orderId: string,
) {
  const preparing = await tx.pickupBatchLine.findFirst({
    where: {
      orderId,
      purpose: "ORDER_DELIVERY",
      OR: [
        {
          deferredAt: null,
          batch: { OR: [
            { status: { in: ["POSTING", "BOOKED", "PICKED_UP"] } },
            { labelsCreationStartedAt: { not: null } },
            { labelsCreatedAt: { not: null } },
          ] },
        },
        { shipmentId: { not: null }, providerLabelCancelledAt: null },
        { providerParcelId: { not: null }, providerLabelCancelledAt: null },
        { courierPickedUpAt: { not: null } },
      ],
    },
    select: { id: true },
  });
  const shipment = await tx.shipment.findFirst({
    where: {
      orderId,
      purpose: "ORDER_DELIVERY",
      OR: [
        { status: { not: "FAILED" } },
        { provider: "X_EXPRESS", providerShipmentId: { not: null } },
      ],
    },
    select: { id: true },
  });
  if (preparing || shipment) {
    throw new OrderCancellationError(
      "Izrada kurirske adresnice je već započeta ili pošiljka već postoji. Porudžbina nije otkazana i ostaje u isporuci. Za obustavu kontaktirajte podršku radi provere i otkazivanja kod kurira.",
      "NOT_ALLOWED",
    );
  }
}
