CREATE TABLE "SefDocument" (
  "id" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "remoteId" TEXT,
  "orderId" TEXT,
  "requestId" TEXT,
  "number" TEXT NOT NULL,
  "supplierName" TEXT NOT NULL,
  "supplierPib" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "customerPib" TEXT NOT NULL,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "currency" TEXT NOT NULL DEFAULT 'RSD',
  "net" DECIMAL(12,2) NOT NULL,
  "vat" DECIMAL(12,2) NOT NULL,
  "gross" DECIMAL(12,2) NOT NULL,
  "xml" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DOWNLOADED',
  "error" TEXT,
  "sentAt" TIMESTAMP(3),
  "inventoryPostedAt" TIMESTAMP(3),
  "inventorySnapshot" JSONB,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SefDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SefDocument_direction_check" CHECK ("direction" IN ('IN', 'OUT')),
  CONSTRAINT "SefDocument_environment_check" CHECK ("environment" IN ('demo', 'production')),
  CONSTRAINT "SefDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SefDocument_requestId_key" ON "SefDocument"("requestId");
CREATE UNIQUE INDEX "SefDocument_environment_direction_remoteId_key" ON "SefDocument"("environment","direction","remoteId");
CREATE UNIQUE INDEX "SefDocument_environment_direction_orderId_key" ON "SefDocument"("environment","direction","orderId");
CREATE INDEX "SefDocument_direction_issueDate_idx" ON "SefDocument"("direction","issueDate");
CREATE INDEX "SefDocument_supplierPib_issueDate_idx" ON "SefDocument"("supplierPib","issueDate");
CREATE INDEX "SefDocument_status_updatedAt_idx" ON "SefDocument"("status","updatedAt");
CREATE UNIQUE INDEX "SefDocument_outbound_number_key" ON "SefDocument"("environment","number") WHERE "direction" = 'OUT';
ALTER TABLE "SefDocument" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "SefDocument" FROM anon, authenticated;
