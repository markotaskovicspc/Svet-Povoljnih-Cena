-- Every inventory command may carry a stable operation key. This makes
-- checkout, receiving, cancellation, refunds and admin retries safe.

ALTER TABLE "StockMovement"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "StockMovement_idempotencyKey_key"
  ON "StockMovement"("idempotencyKey");
