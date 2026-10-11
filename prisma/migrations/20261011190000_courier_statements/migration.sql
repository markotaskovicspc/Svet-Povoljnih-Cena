CREATE TABLE "CourierStatement" (
  "id" TEXT NOT NULL, "provider" TEXT NOT NULL, "documentNo" TEXT NOT NULL,
  "filename" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CourierStatement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourierStatement_provider_check" CHECK ("provider" IN ('MYGLS','X_EXPRESS'))
);
CREATE TABLE "CourierStatementLine" (
  "id" TEXT NOT NULL, "statementId" TEXT NOT NULL, "lineKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "trackingNo" TEXT NOT NULL, "orderNumber" TEXT,
  "bookedOn" DATE NOT NULL, "amountNet" DECIMAL(12,2) NOT NULL,
  "amountGross" DECIMAL(12,2) NOT NULL, "weightKg" DECIMAL(10,3),
  "description" TEXT, "shipmentId" TEXT,
  CONSTRAINT "CourierStatementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CourierStatementLine_kind_check" CHECK ("kind" IN ('COST','COD')),
  CONSTRAINT "CourierStatementLine_amount_check" CHECK ("amountNet" >= 0 AND "amountGross" >= 0),
  CONSTRAINT "CourierStatementLine_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CourierStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CourierStatementLine_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CourierStatement_provider_documentNo_key" ON "CourierStatement"("provider", "documentNo");
CREATE UNIQUE INDEX "CourierStatement_provider_fingerprint_key" ON "CourierStatement"("provider", "fingerprint");
CREATE UNIQUE INDEX "CourierStatementLine_statementId_lineKey_key" ON "CourierStatementLine"("statementId", "lineKey");
CREATE INDEX "CourierStatementLine_bookedOn_kind_idx" ON "CourierStatementLine"("bookedOn", "kind");
CREATE INDEX "CourierStatementLine_shipmentId_kind_idx" ON "CourierStatementLine"("shipmentId", "kind");
ALTER TABLE "CourierStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CourierStatementLine" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CourierStatement", "CourierStatementLine" FROM anon, authenticated;
