import "server-only";

import type { Prisma } from "@prisma/client";
import { OrderCancellationError } from "./cancellation";

/** Call while holding the order lock, shared with pickup label preparation. */
export async function assertOrderCancellationBeforeCourier(
  tx: Pick<Prisma.TransactionClient, "pickupBatchLine" | "shipment" | "orderItem">,
  orderId: string,
  options: { allowConfirmedDeleted?: boolean } = {},
) {
  const lines = await tx.pickupBatchLine.findMany({
    where: {
      orderId,
      purpose: "ORDER_DELIVERY",
    },
    select: {
      shipmentId: true,
      providerParcelId: true,
      providerLabelCancelledAt: true,
      courierPickedUpAt: true,
      deferredAt: true,
      orderItem: { select: { warehouseDispatchedQty: true } },
      batch: { select: {
        provider: true,
        status: true,
        labelsCreationStartedAt: true,
        labelsCreatedAt: true,
      } },
    },
  });
  const shipments = await tx.shipment.findMany({
    where: {
      orderId,
      purpose: "ORDER_DELIVERY",
    },
    select: {
      id: true,
      provider: true,
      providerShipmentId: true,
      status: true,
      providerStatusCode: true,
      createdAt: true,
      lastStatusSyncAt: true,
      lastStatusEventAt: true,
      shippedAt: true,
      deliveredAt: true,
      events: { select: { status: true, providerStatusCode: true, occurredAt: true } },
    },
  });
  // FAILED also represents damaged/lost parcels and unknown carrier codes.
  // Only a matching carrier DELETED event proves that an X Express label is retired.
  const deletedShipments = shipments.filter((shipment) =>
    options.allowConfirmedDeleted &&
    shipment.provider === "X_EXPRESS" &&
    shipment.providerShipmentId &&
    shipment.status === "FAILED" &&
    shipment.providerStatusCode === "DELETED" &&
    shipment.lastStatusSyncAt &&
    shipment.lastStatusEventAt &&
    !shipment.shippedAt &&
    !shipment.deliveredAt &&
    shipment.events.every((event) => event.status === "CREATED" ||
      (event.status === "FAILED" && event.providerStatusCode === "DELETED")) &&
    shipment.events.some((event) =>
      event.status === "FAILED" && event.providerStatusCode === "DELETED" &&
      event.occurredAt.getTime() === shipment.lastStatusEventAt!.getTime(),
    ),
  );
  const deletedById = new Map(deletedShipments.map((shipment) => [shipment.id, shipment]));
  const dispatchedItem = deletedShipments.length > 0 && await tx.orderItem.findFirst({
    where: { orderId, warehouseDispatchedQty: { gt: 0 } },
    select: { id: true },
  });
  const shipmentBlocks = shipments.some((shipment) =>
    shipment.status !== "FAILED" ||
    (shipment.provider === "X_EXPRESS" && shipment.providerShipmentId && !deletedById.has(shipment.id)),
  );
  const preparing = lines.some((line) => {
    if (line.courierPickedUpAt || (line.orderItem?.warehouseDispatchedQty ?? 0) > 0 ||
        line.batch.status === "PICKED_UP" || line.batch.status === "POSTING") return true;

    // Old X Express picking lines have no shipmentId. For those rows, require
    // every delivery shipment to be deleted after this completed batch's labels.
    const candidates = line.shipmentId
      ? [deletedById.get(line.shipmentId)].filter((shipment) => shipment !== undefined)
      : !line.providerParcelId && shipments.length > 0 && deletedShipments.length === shipments.length
        ? deletedShipments : [];
    const retiredPicking = line.batch.provider === "X_EXPRESS" &&
      line.batch.status === "BOOKED" && line.batch.labelsCreatedAt &&
      candidates.length > 0 && candidates.every((shipment) =>
        shipment.createdAt <= line.batch.labelsCreatedAt! &&
        shipment.lastStatusEventAt! >= line.batch.labelsCreatedAt!,
      );
    if (retiredPicking) return false;

    return (!line.deferredAt && (
      line.batch.status === "BOOKED" || line.batch.labelsCreationStartedAt || line.batch.labelsCreatedAt
    )) || (!line.providerLabelCancelledAt && (line.shipmentId || line.providerParcelId));
  });
  if (preparing || shipmentBlocks || dispatchedItem) {
    throw new OrderCancellationError(
      "Izrada kurirske adresnice je u toku, postoji aktivna pošiljka ili je roba već preuzeta. Porudžbina nije otkazana. Za obustavu je potrebna provera i potvrda otkazivanja kod kurira.",
      "NOT_ALLOWED",
    );
  }
}
