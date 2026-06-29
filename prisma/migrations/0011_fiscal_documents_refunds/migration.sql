-- Fiscal documents, per-line refund tracking, and warehouse stock returns.

CREATE TYPE "FiscalDocumentKind" AS ENUM ('SALE', 'REFUND');
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('PENDING', 'ISSUED', 'FAILED');
CREATE TYPE "FiscalDocumentSource" AS ENUM ('AUTO_ADVANCE', 'AUTO_PICKUP', 'MANUAL', 'REFUND');
CREATE TYPE "StockMovementKind" AS ENUM ('SALE_RESERVATION', 'REFUND_RETURN', 'ADJUSTMENT');
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

ALTER TABLE "OrderItem"
  ADD COLUMN "supplierName" TEXT,
  ADD COLUMN "categoryName" TEXT,
  ADD COLUMN "categoryPath" TEXT,
  ADD COLUMN "groupName" TEXT,
  ADD COLUMN "subgroupName" TEXT,
  ADD COLUMN "collectionName" TEXT,
  ADD COLUMN "shortDescriptionSnapshot" TEXT,
  ADD COLUMN "shortNameSnapshot" TEXT,
  ADD COLUMN "attribute1" TEXT,
  ADD COLUMN "attribute2" TEXT,
  ADD COLUMN "attribute3" TEXT,
  ADD COLUMN "attribute4" TEXT,
  ADD COLUMN "color1" TEXT,
  ADD COLUMN "color2" TEXT;

CREATE TABLE "Warehouse" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
CREATE INDEX "Warehouse_active_isDefault_idx" ON "Warehouse"("active", "isDefault");

INSERT INTO "Warehouse" ("id", "code", "name", "isDefault", "active", "createdAt", "updatedAt")
VALUES ('dc-default', 'DC', 'DC', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "isDefault" = true, "active" = true, "updatedAt" = CURRENT_TIMESTAMP;

CREATE TABLE "FiscalDocument" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kind" "FiscalDocumentKind" NOT NULL,
  "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "source" "FiscalDocumentSource" NOT NULL DEFAULT 'MANUAL',
  "paymentMethod" "PaymentMethod",
  "warehouseId" TEXT,
  "receiptNumber" TEXT,
  "qrUrl" TEXT,
  "pdfUrl" TEXT,
  "pdfObjectKey" TEXT,
  "recipientEmail" TEXT,
  "emailedAt" TIMESTAMP(3),
  "emailError" TEXT,
  "rawRequest" JSONB,
  "rawResponse" JSONB,
  "error" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "totalNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalVat" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "totalGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "issuedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FiscalDocument_receiptNumber_key" ON "FiscalDocument"("receiptNumber");
CREATE UNIQUE INDEX "FiscalDocument_idempotencyKey_key" ON "FiscalDocument"("idempotencyKey");
CREATE INDEX "FiscalDocument_orderId_kind_idx" ON "FiscalDocument"("orderId", "kind");
CREATE INDEX "FiscalDocument_kind_status_issuedAt_idx" ON "FiscalDocument"("kind", "status", "issuedAt");
CREATE INDEX "FiscalDocument_source_createdAt_idx" ON "FiscalDocument"("source", "createdAt");
CREATE INDEX "FiscalDocument_warehouseId_idx" ON "FiscalDocument"("warehouseId");

CREATE TABLE "FiscalDocumentLine" (
  "id" TEXT NOT NULL,
  "fiscalDocumentId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "productId" TEXT,
  "originalSaleLineId" TEXT,
  "priceList" TEXT NOT NULL DEFAULT 'MP',
  "orderNumber" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "companyName" TEXT,
  "pib" TEXT,
  "address" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "sku" TEXT NOT NULL,
  "supplierName" TEXT,
  "categoryName" TEXT,
  "categoryPath" TEXT,
  "groupName" TEXT,
  "subgroupName" TEXT,
  "collectionName" TEXT,
  "shortDescription" TEXT,
  "shortName" TEXT NOT NULL,
  "attribute1" TEXT,
  "attribute2" TEXT,
  "attribute3" TEXT,
  "attribute4" TEXT,
  "color1" TEXT,
  "color2" TEXT,
  "warehouseName" TEXT,
  "qty" INTEGER NOT NULL,
  "refundedQty" INTEGER NOT NULL DEFAULT 0,
  "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 20,
  "unitPriceGross" DECIMAL(12,2) NOT NULL,
  "totalNet" DECIMAL(12,2) NOT NULL,
  "totalVat" DECIMAL(12,2) NOT NULL,
  "totalGross" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FiscalDocumentLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FiscalDocumentLine_fiscalDocumentId_idx" ON "FiscalDocumentLine"("fiscalDocumentId");
CREATE INDEX "FiscalDocumentLine_orderItemId_idx" ON "FiscalDocumentLine"("orderItemId");
CREATE INDEX "FiscalDocumentLine_productId_idx" ON "FiscalDocumentLine"("productId");
CREATE INDEX "FiscalDocumentLine_originalSaleLineId_idx" ON "FiscalDocumentLine"("originalSaleLineId");
CREATE INDEX "FiscalDocumentLine_sku_idx" ON "FiscalDocumentLine"("sku");

CREATE TABLE "WarehouseStock" (
  "id" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "qty" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarehouseStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseStock_warehouseId_productId_key" ON "WarehouseStock"("warehouseId", "productId");
CREATE INDEX "WarehouseStock_productId_idx" ON "WarehouseStock"("productId");

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "productId" TEXT,
  "orderId" TEXT,
  "orderItemId" TEXT,
  "fiscalDocumentId" TEXT,
  "kind" "StockMovementKind" NOT NULL,
  "sku" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "note" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockMovement_warehouseId_createdAt_idx" ON "StockMovement"("warehouseId", "createdAt");
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");
CREATE INDEX "StockMovement_orderId_idx" ON "StockMovement"("orderId");
CREATE INDEX "StockMovement_fiscalDocumentId_idx" ON "StockMovement"("fiscalDocumentId");
CREATE INDEX "StockMovement_sku_idx" ON "StockMovement"("sku");

CREATE TABLE "PaymentRefund" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "fiscalDocumentId" TEXT,
  "method" "PaymentMethod" NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'MANUAL',
  "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RSD',
  "providerRef" TEXT,
  "rawRequest" JSONB,
  "rawResponse" JSONB,
  "error" TEXT,
  "actorId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentRefund_orderId_createdAt_idx" ON "PaymentRefund"("orderId", "createdAt");
CREATE INDEX "PaymentRefund_fiscalDocumentId_idx" ON "PaymentRefund"("fiscalDocumentId");
CREATE INDEX "PaymentRefund_method_status_idx" ON "PaymentRefund"("method", "status");

ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FiscalDocumentLine" ADD CONSTRAINT "FiscalDocumentLine_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalDocumentLine" ADD CONSTRAINT "FiscalDocumentLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalDocumentLine" ADD CONSTRAINT "FiscalDocumentLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FiscalDocumentLine" ADD CONSTRAINT "FiscalDocumentLine_originalSaleLineId_fkey" FOREIGN KEY ("originalSaleLineId") REFERENCES "FiscalDocumentLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseStock" ADD CONSTRAINT "WarehouseStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_fiscalDocumentId_fkey" FOREIGN KEY ("fiscalDocumentId") REFERENCES "FiscalDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
