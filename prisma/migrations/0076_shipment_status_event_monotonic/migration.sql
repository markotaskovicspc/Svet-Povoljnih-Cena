ALTER TABLE "Shipment"
  ADD COLUMN "lastStatusEventAt" TIMESTAMP(3);

UPDATE "Shipment" AS shipment
SET "lastStatusEventAt" = COALESCE(
  (
    SELECT MAX(event."occurredAt")
    FROM "ShipmentEvent" AS event
    WHERE event."shipmentId" = shipment."id"
  ),
  shipment."deliveredAt",
  shipment."shippedAt"
);

CREATE INDEX "Shipment_lastStatusEventAt_idx"
  ON "Shipment"("lastStatusEventAt");
