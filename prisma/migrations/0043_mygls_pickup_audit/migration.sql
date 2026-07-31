ALTER TABLE "PickupBatch"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "pickupWindowEnd" TIMESTAMP(3),
  ADD COLUMN "labelsCreationStartedAt" TIMESTAMP(3),
  ADD COLUMN "labelsCreatedAt" TIMESTAMP(3),
  ADD COLUMN "labelsCreatedById" TEXT,
  ADD COLUMN "externalBookedAt" TIMESTAMP(3),
  ADD COLUMN "externalBookingChannel" TEXT,
  ADD COLUMN "externalBookingReference" TEXT,
  ADD COLUMN "externalBookedById" TEXT;

ALTER TABLE "PickupBatch"
  ADD CONSTRAINT "PickupBatch_pickup_window_order"
  CHECK (
    "pickupWindowEnd" IS NULL
    OR "pickupDate" IS NULL
    OR "pickupWindowEnd" > "pickupDate"
  ),
  ADD CONSTRAINT "PickupBatch_external_booking_channel"
  CHECK (
    "externalBookingChannel" IS NULL
    OR "externalBookingChannel" IN ('MYGLS_PORTAL', 'EMAIL', 'PHONE', 'FIXED_SCHEDULE')
  );

CREATE INDEX "PickupBatch_provider_status_pickupDate_idx"
  ON "PickupBatch"("provider", "status", "pickupDate");
