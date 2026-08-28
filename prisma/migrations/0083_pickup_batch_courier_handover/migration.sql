-- Record the physical warehouse handover independently from courier webhooks.
-- A picking group can contain multiple package rows; the admin action updates
-- every row in the group atomically.
ALTER TABLE "PickupBatchLine"
  ADD COLUMN "courierPickedUpAt" TIMESTAMP(3),
  ADD COLUMN "courierPickedUpById" TEXT;
