-- Checkout hardening, durable buyer receipts, XML diagnostics, and ERP persistence foundation.

-- Enums
CREATE TYPE "InvoiceKind" AS ENUM ('PROFORMA', 'BUYER_RECEIPT');
CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'EMAIL_SENT', 'EMAIL_FAILED', 'CANCELLED');
CREATE TYPE "ErpCurrency" AS ENUM ('RSD', 'EUR', 'USD');
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SENT', 'CONFIRMED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "InboundInvoiceType" AS ENUM ('DOM', 'INO', 'COGS');
CREATE TYPE "InboundInvoiceStatus" AS ENUM ('DRAFT', 'RECEIVED', 'POSTED', 'CANCELLED');
CREATE TYPE "CogsStatus" AS ENUM ('PENDING', 'CALCULATED', 'LOCKED');

-- Order access and pending payment lifecycle
ALTER TABLE "Order"
  ADD COLUMN "publicAccessTokenHash" TEXT,
  ADD COLUMN "publicAccessTokenCreatedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "stockRestoredAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Order_publicAccessTokenHash_key" ON "Order"("publicAccessTokenHash");
CREATE INDEX "Order_expiresAt_idx" ON "Order"("expiresAt");

-- XML import diagnostics and product override metadata
ALTER TABLE "Product" ADD COLUMN "syncOverrides" JSONB;
ALTER TABLE "ImportRun"
  ADD COLUMN "dryRun" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "errors" JSONB;

-- First-class buyer receipt / proforma data
ALTER TABLE "Invoice"
  ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'PROFORMA',
  ADD COLUMN "status" "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
  ADD COLUMN "pdfObjectKey" TEXT,
  ADD COLUMN "recipientEmail" TEXT,
  ADD COLUMN "emailedAt" TIMESTAMP(3),
  ADD COLUMN "emailError" TEXT,
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "Invoice_orderId_kind_key" ON "Invoice"("orderId", "kind");
CREATE INDEX "Invoice_kind_issuedAt_idx" ON "Invoice"("kind", "issuedAt");
CREATE INDEX "Invoice_status_issuedAt_idx" ON "Invoice"("status", "issuedAt");

-- ERP purchase price foundation
CREATE TABLE "PurchasePrice" (
  "id" TEXT NOT NULL,
  "productId" TEXT,
  "supplierId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT,
  "attributes" TEXT,
  "pattern" TEXT,
  "price" DECIMAL(12,2) NOT NULL,
  "currency" "ErpCurrency" NOT NULL DEFAULT 'RSD',
  "parity" TEXT,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchasePrice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchasePrice_sku_idx" ON "PurchasePrice"("sku");
CREATE INDEX "PurchasePrice_supplierId_validFrom_idx" ON "PurchasePrice"("supplierId", "validFrom");
CREATE INDEX "PurchasePrice_productId_validFrom_idx" ON "PurchasePrice"("productId", "validFrom");

ALTER TABLE "PurchasePrice"
  ADD CONSTRAINT "PurchasePrice_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchasePrice"
  ADD CONSTRAINT "PurchasePrice_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ERP purchase orders
CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "supplierId" TEXT,
  "orderDate" TIMESTAMP(3),
  "loadingDate" TIMESTAMP(3),
  "deliveryDate" TIMESTAMP(3),
  "totalVolume" DECIMAL(12,3),
  "totalWeight" DECIMAL(12,3),
  "totalPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" "ErpCurrency" NOT NULL DEFAULT 'RSD',
  "transportType" TEXT,
  "parity" TEXT,
  "bmPct" DECIMAL(8,2),
  "pdfUrl" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");
CREATE INDEX "PurchaseOrder_supplierId_createdAt_idx" ON "PurchaseOrder"("supplierId", "createdAt");
CREATE INDEX "PurchaseOrder_status_createdAt_idx" ON "PurchaseOrder"("status", "createdAt");

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PurchaseOrderItem" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "attributes" TEXT,
  "pattern" TEXT,
  "purchasePrice" DECIMAL(12,2) NOT NULL,
  "currency" "ErpCurrency" NOT NULL DEFAULT 'RSD',
  "parity" TEXT,
  "moq" INTEGER,
  "packQty" INTEGER,
  "qty" INTEGER NOT NULL,
  "receivedQty" INTEGER NOT NULL DEFAULT 0,
  "totalVolume" DECIMAL(12,3),
  "totalWeight" DECIMAL(12,3),
  "customsRate" DECIMAL(8,2),
  "calcRetailPrice" DECIMAL(12,2),
  "bmPct" DECIMAL(8,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX "PurchaseOrderItem_sku_idx" ON "PurchaseOrderItem"("sku");
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PurchaseOrderStatusEvent" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL,
  "note" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrderStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseOrderStatusEvent_purchaseOrderId_createdAt_idx"
  ON "PurchaseOrderStatusEvent"("purchaseOrderId", "createdAt");

ALTER TABLE "PurchaseOrderStatusEvent"
  ADD CONSTRAINT "PurchaseOrderStatusEvent_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ERP inbound invoices
CREATE TABLE "InboundInvoice" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "type" "InboundInvoiceType" NOT NULL,
  "supplierId" TEXT,
  "status" "InboundInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "invoiceDate" TIMESTAMP(3),
  "currency" "ErpCurrency" NOT NULL DEFAULT 'RSD',
  "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "cogsStatus" "CogsStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InboundInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundInvoice_number_key" ON "InboundInvoice"("number");
CREATE INDEX "InboundInvoice_supplierId_invoiceDate_idx" ON "InboundInvoice"("supplierId", "invoiceDate");
CREATE INDEX "InboundInvoice_status_invoiceDate_idx" ON "InboundInvoice"("status", "invoiceDate");

ALTER TABLE "InboundInvoice"
  ADD CONSTRAINT "InboundInvoice_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "InboundInvoiceItem" (
  "id" TEXT NOT NULL,
  "inboundInvoiceId" TEXT NOT NULL,
  "productId" TEXT,
  "sku" TEXT,
  "name" TEXT NOT NULL,
  "qty" INTEGER NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "total" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundInvoiceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InboundInvoiceItem_inboundInvoiceId_idx" ON "InboundInvoiceItem"("inboundInvoiceId");
CREATE INDEX "InboundInvoiceItem_sku_idx" ON "InboundInvoiceItem"("sku");
CREATE INDEX "InboundInvoiceItem_productId_idx" ON "InboundInvoiceItem"("productId");

ALTER TABLE "InboundInvoiceItem"
  ADD CONSTRAINT "InboundInvoiceItem_inboundInvoiceId_fkey"
  FOREIGN KEY ("inboundInvoiceId") REFERENCES "InboundInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundInvoiceItem"
  ADD CONSTRAINT "InboundInvoiceItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CMS content pages
CREATE TABLE "ContentPage" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "lead" TEXT,
  "bodyMarkdown" TEXT NOT NULL,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentPage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentPage_slug_key" ON "ContentPage"("slug");
CREATE INDEX "ContentPage_published_updatedAt_idx" ON "ContentPage"("published", "updatedAt");
