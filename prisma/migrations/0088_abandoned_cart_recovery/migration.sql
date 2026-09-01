ALTER TABLE "CheckoutSession"
  ADD COLUMN "cartSnapshot" JSONB,
  ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "recoveryConsent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "recoveryConsentAt" TIMESTAMP(3),
  ADD COLUMN "recoveryStep" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recoveryNextSendAt" TIMESTAMP(3),
  ADD COLUMN "recoveryLastSentAt" TIMESTAMP(3),
  ADD COLUMN "recoveryClickedAt" TIMESTAMP(3),
  ADD COLUMN "recoveryClickedStep" INTEGER,
  ADD COLUMN "recoveryStoppedAt" TIMESTAMP(3),
  ADD COLUMN "recoveryStopReason" TEXT;

UPDATE "CheckoutSession"
SET "lastActivityAt" = "updatedAt";

CREATE INDEX "CheckoutSession_status_recoveryNextSendAt_idx"
  ON "CheckoutSession"("status", "recoveryNextSendAt");
