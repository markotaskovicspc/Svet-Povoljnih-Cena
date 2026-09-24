CREATE TABLE "AnanasDocument" (
  "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "externalId" TEXT NOT NULL,
  "fiscalNumber" TEXT NOT NULL, "reference" TEXT, "orderNumber" TEXT NOT NULL,
  "suborderNumber" TEXT NOT NULL, "issuedAt" TIMESTAMP(3) NOT NULL,
  "invoicedAt" TIMESTAMP(3) NOT NULL, "gross" DECIMAL(16,2) NOT NULL,
  "net" DECIMAL(16,2) NOT NULL, "vat" DECIMAL(16,2) NOT NULL,
  "paymentMethods" TEXT NOT NULL, "items" JSONB NOT NULL,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnanasDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnanasDocument_kind_check" CHECK ("kind" IN ('SALE', 'REFUND'))
);
CREATE UNIQUE INDEX "AnanasDocument_kind_externalId_key" ON "AnanasDocument"("kind", "externalId");
CREATE UNIQUE INDEX "AnanasDocument_kind_fiscalNumber_key" ON "AnanasDocument"("kind", "fiscalNumber");
CREATE INDEX "AnanasDocument_issuedAt_kind_idx" ON "AnanasDocument"("issuedAt", "kind");
CREATE INDEX "AnanasDocument_suborderNumber_idx" ON "AnanasDocument"("suborderNumber");
CREATE TABLE "AnanasSyncRun" (
  "id" TEXT NOT NULL, "source" TEXT NOT NULL, "status" TEXT NOT NULL,
  "from" TIMESTAMP(3) NOT NULL, "to" TIMESTAMP(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AnanasSyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnanasSyncRun_startedAt_idx" ON "AnanasSyncRun"("startedAt");
CREATE INDEX "AnanasSyncRun_source_status_to_idx" ON "AnanasSyncRun"("source", "status", "to");
ALTER TABLE "AnanasDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnanasSyncRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AnanasDocument", "AnanasSyncRun" FROM anon, authenticated;
