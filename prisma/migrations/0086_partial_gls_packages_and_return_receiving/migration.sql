-- Additive state needed to identify, defer, cancel and later reschedule one
-- physical MyGLS package without releasing the parent order reservation.
ALTER TABLE "Shipment"
ADD COLUMN "codAmount" DECIMAL(12,2);

ALTER TABLE "PickupBatchLine"
ADD COLUMN "shipmentId" TEXT,
ADD COLUMN "providerParcelId" TEXT,
ADD COLUMN "providerParcelNumber" TEXT,
ADD COLUMN "providerClientReference" TEXT,
ADD COLUMN "providerCodAmount" DECIMAL(12,2),
ADD COLUMN "packageValue" DECIMAL(12,2),
ADD COLUMN "providerStatusCode" TEXT,
ADD COLUMN "providerStatusLabel" TEXT,
ADD COLUMN "providerStatusAt" TIMESTAMP(3),
ADD COLUMN "cancellationRequestedAt" TIMESTAMP(3),
ADD COLUMN "providerLabelCancelledAt" TIMESTAMP(3),
ADD COLUMN "codAdjustedAt" TIMESTAMP(3),
ADD COLUMN "cancellationError" TEXT,
ADD COLUMN "deferredAt" TIMESTAMP(3),
ADD COLUMN "deferredById" TEXT,
ADD COLUMN "rescheduledAt" TIMESTAMP(3),
ADD COLUMN "deferredFromLineId" TEXT;

ALTER TABLE "PickupBatchLine"
ADD CONSTRAINT "PickupBatchLine_shipmentId_fkey"
FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PickupBatchLine_shipmentId_idx" ON "PickupBatchLine"("shipmentId");
CREATE INDEX "PickupBatchLine_providerParcelNumber_idx" ON "PickupBatchLine"("providerParcelNumber");
CREATE INDEX "PickupBatchLine_deferredAt_rescheduledAt_idx" ON "PickupBatchLine"("deferredAt", "rescheduledAt");
CREATE INDEX "PickupBatchLine_deferredFromLineId_idx" ON "PickupBatchLine"("deferredFromLineId");
