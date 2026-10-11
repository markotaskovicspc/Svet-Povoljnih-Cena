ALTER TABLE "AnanasDocument"
  ADD COLUMN "inventoryPostedAt" TIMESTAMP(3),
  ADD COLUMN "inventoryFingerprint" TEXT,
  ADD COLUMN "inventoryError" TEXT;
CREATE INDEX "AnanasDocument_inventoryPostedAt_issuedAt_idx" ON "AnanasDocument"("inventoryPostedAt", "issuedAt");
