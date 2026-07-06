-- badi.rs fiscalization provider: buyer identification, dispatch tracking,
-- provider product catalog sync, and non-item (shipping) fiscal lines.

ALTER TABLE "FiscalDocument"
  ADD COLUMN "buyerId" TEXT,
  ADD COLUMN "dispatchedAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

ALTER TABLE "FiscalDocumentLine"
  ALTER COLUMN "orderItemId" DROP NOT NULL;

CREATE TABLE "FiscalProductSync" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'badi',
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "taxRateLabel" TEXT NOT NULL DEFAULT 'Ђ',
  "isService" BOOLEAN NOT NULL DEFAULT false,
  "providerId" TEXT,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FiscalProductSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalProductSync_provider_sku_key" ON "FiscalProductSync"("provider", "sku");
CREATE INDEX "FiscalProductSync_sku_idx" ON "FiscalProductSync"("sku");
