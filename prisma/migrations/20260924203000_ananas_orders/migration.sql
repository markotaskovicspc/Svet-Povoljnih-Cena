CREATE TABLE "AnanasOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "total" DECIMAL(16,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "paymentMethods" TEXT NOT NULL,
  "customerName" TEXT,
  "billingAddress" JSONB NOT NULL,
  "items" JSONB NOT NULL,
  "shipments" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'Čeka proveru',
  "needsRefresh" BOOLEAN NOT NULL DEFAULT true,
  "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00',
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AnanasOrder_createdAt_idx" ON "AnanasOrder"("createdAt");
CREATE INDEX "AnanasOrder_needsRefresh_lastCheckedAt_idx" ON "AnanasOrder"("needsRefresh", "lastCheckedAt");
CREATE INDEX "AnanasDocument_orderNumber_idx" ON "AnanasDocument"("orderNumber");
ALTER TABLE "AnanasOrder" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AnanasOrder" FROM anon, authenticated;
