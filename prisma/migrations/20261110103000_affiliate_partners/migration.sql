CREATE TABLE "AffiliatePartner" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffiliatePartner_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AffiliatePartner_code_key" ON "AffiliatePartner"("code");
CREATE TABLE "AffiliateClick" (
  "id" TEXT NOT NULL, "partnerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AffiliateClick_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AffiliateClick_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AffiliatePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AffiliateClick_partnerId_createdAt_idx" ON "AffiliateClick"("partnerId", "createdAt");
CREATE INDEX "AffiliateClick_expiresAt_idx" ON "AffiliateClick"("expiresAt");
ALTER TABLE "Order" ADD COLUMN "affiliateClickId" TEXT;
CREATE INDEX "Order_affiliateClickId_idx" ON "Order"("affiliateClickId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_affiliateClickId_fkey" FOREIGN KEY ("affiliateClickId") REFERENCES "AffiliateClick"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AffiliatePartner" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AffiliateClick" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AffiliatePartner", "AffiliateClick" FROM anon, authenticated;
