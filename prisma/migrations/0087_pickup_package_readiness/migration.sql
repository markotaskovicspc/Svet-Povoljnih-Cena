-- Warehouse confirmation gate before labels are created or a courier is called.
ALTER TABLE "PickupBatchLine"
ADD COLUMN "warehouseReadyAt" TIMESTAMP(3),
ADD COLUMN "warehouseReadyById" TEXT;

CREATE INDEX "PickupBatchLine_batchId_deferredAt_warehouseReadyAt_idx"
ON "PickupBatchLine"("batchId", "deferredAt", "warehouseReadyAt");
