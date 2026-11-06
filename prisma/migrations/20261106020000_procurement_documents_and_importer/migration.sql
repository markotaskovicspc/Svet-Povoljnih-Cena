CREATE TYPE "ImporterCompany" AS ENUM ('SPC', 'EVONEK');

ALTER TABLE "PurchaseOrder"
ADD COLUMN "importerCompany" "ImporterCompany";

CREATE TABLE "ProcurementDocument" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "inboundInvoiceId" TEXT,
  "originalFilename" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcurementDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcurementDocument_one_owner_check" CHECK (
    ("purchaseOrderId" IS NOT NULL AND "inboundInvoiceId" IS NULL)
    OR ("purchaseOrderId" IS NULL AND "inboundInvoiceId" IS NOT NULL)
  ),
  CONSTRAINT "ProcurementDocument_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProcurementDocument_inboundInvoiceId_fkey"
    FOREIGN KEY ("inboundInvoiceId") REFERENCES "InboundInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProcurementDocument_storageKey_key"
ON "ProcurementDocument"("storageKey");

CREATE INDEX "ProcurementDocument_purchaseOrderId_createdAt_idx"
ON "ProcurementDocument"("purchaseOrderId", "createdAt");

CREATE INDEX "ProcurementDocument_inboundInvoiceId_createdAt_idx"
ON "ProcurementDocument"("inboundInvoiceId", "createdAt");

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'erp-documents',
  'erp-documents',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
