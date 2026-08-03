ALTER TABLE "InboundInvoice"
  ALTER COLUMN "type" SET DEFAULT 'COGS',
  ADD COLUMN "invoiceValueRsd" DECIMAL(12,2),
  ADD COLUMN "customsValueRsd" DECIMAL(12,2),
  ADD COLUMN "transportValueRsd" DECIMAL(12,2),
  ADD COLUMN "otherRelatedCostsRsd" DECIMAL(12,2);
