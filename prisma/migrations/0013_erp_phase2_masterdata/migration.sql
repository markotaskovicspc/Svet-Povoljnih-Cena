-- ERP Phase 2: article COGS/attributes/availability, supplier master data,
-- and retail-price (MPC) proposals.

-- Product: ERP attributes (Atribut 1-4), COGS, customs rate, manual availability checks.
ALTER TABLE "Product"
  ADD COLUMN "attribute1" TEXT,
  ADD COLUMN "attribute2" TEXT,
  ADD COLUMN "attribute3" TEXT,
  ADD COLUMN "attribute4" TEXT,
  ADD COLUMN "cogs" DECIMAL(12,2),
  ADD COLUMN "customsRate" DECIMAL(8,2),
  ADD COLUMN "availableWebManual" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "availableWholesaleManual" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "availableExportManual" BOOLEAN NOT NULL DEFAULT true;

-- Supplier: master data (spec §2).
ALTER TABLE "Supplier"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "address" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "country" TEXT DEFAULT 'RS',
  ADD COLUMN "email" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "currency" "ErpCurrency" NOT NULL DEFAULT 'RSD',
  ADD COLUMN "parity" TEXT,
  ADD COLUMN "paymentTerms" TEXT,
  ADD COLUMN "deliveryDays" INTEGER,
  ADD COLUMN "transitDays" INTEGER,
  ADD COLUMN "bank" TEXT,
  ADD COLUMN "swift" TEXT,
  ADD COLUMN "iban" TEXT;

CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- Retail-price (MPC) proposals (spec §6/§7).
CREATE TYPE "RetailPriceProposalStatus" AS ENUM ('PREDLOG', 'OBJAVLJENO', 'ARHIVA');

CREATE TABLE "RetailPriceProposal" (
  "id" TEXT NOT NULL,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT,
  "currentMpc" DECIMAL(12,2),
  "proposedMpc" DECIMAL(12,2) NOT NULL,
  "bmPct" DECIMAL(8,2),
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "status" "RetailPriceProposalStatus" NOT NULL DEFAULT 'PREDLOG',
  "actorId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RetailPriceProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RetailPriceProposal_sku_idx" ON "RetailPriceProposal"("sku");
CREATE INDEX "RetailPriceProposal_status_idx" ON "RetailPriceProposal"("status");

ALTER TABLE "RetailPriceProposal"
  ADD CONSTRAINT "RetailPriceProposal_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
