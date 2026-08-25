ALTER TABLE "PickupBatchLine"
  ADD COLUMN "reclamationId" TEXT,
  ADD COLUMN "purpose" "ShipmentPurpose" NOT NULL DEFAULT 'ORDER_DELIVERY',
  ADD COLUMN "lineGroupKey" TEXT,
  ADD COLUMN "quantity" INTEGER;

UPDATE "PickupBatchLine"
SET "lineGroupKey" = 'order:' || "orderId";

ALTER TABLE "PickupBatchLine"
  ALTER COLUMN "lineGroupKey" SET NOT NULL;

DROP INDEX IF EXISTS "PickupBatchLine_batchId_orderId_packageNo_key";

CREATE UNIQUE INDEX "PickupBatchLine_batchId_lineGroupKey_packageNo_key"
  ON "PickupBatchLine"("batchId", "lineGroupKey", "packageNo");

CREATE UNIQUE INDEX "PickupBatchLine_reclamationId_packageNo_key"
  ON "PickupBatchLine"("reclamationId", "packageNo");

CREATE INDEX "PickupBatchLine_reclamationId_idx"
  ON "PickupBatchLine"("reclamationId");

CREATE INDEX "PickupBatchLine_purpose_orderId_idx"
  ON "PickupBatchLine"("purpose", "orderId");

ALTER TABLE "PickupBatchLine"
  ADD CONSTRAINT "PickupBatchLine_reclamationId_fkey"
  FOREIGN KEY ("reclamationId") REFERENCES "Reclamation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
