-- PrintLabels is both label creation and the external MyGLS API announcement.
-- Keep the database constraint aligned with the application booking-channel
-- type so a successful provider call can be finalized as BOOKED atomically.
ALTER TABLE "PickupBatch"
  DROP CONSTRAINT IF EXISTS "PickupBatch_external_booking_channel";

ALTER TABLE "PickupBatch"
  ADD CONSTRAINT "PickupBatch_external_booking_channel"
  CHECK (
    "externalBookingChannel" IS NULL
    OR "externalBookingChannel" IN (
      'MYGLS_API',
      'MYGLS_PORTAL',
      'EMAIL',
      'PHONE',
      'FIXED_SCHEDULE'
    )
  );
