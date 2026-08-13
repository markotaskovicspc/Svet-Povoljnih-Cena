-- Keep the pre-invoice COGS state so locking an inbound invoice can book the
-- weighted COGS immediately, remain idempotent, and still be reversible before
-- goods receipt.
ALTER TABLE "PurchaseOrder"
  ADD COLUMN IF NOT EXISTS "cogsBookingSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "cogsBookedAt" TIMESTAMP(3);
