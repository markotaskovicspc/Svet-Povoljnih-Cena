ALTER TABLE "PurchaseOrder"
ADD COLUMN "retailValueSnapshot" JSONB;

ALTER TABLE "DispatchNote"
ADD COLUMN "retailValueSnapshot" JSONB;
