-- The receiving warehouse is chosen when the goods actually arrive, on the
-- inbound invoice. PurchaseOrder.receivingWarehouseId remains as a legacy
-- snapshot for already posted documents.
ALTER TABLE "InboundInvoice"
  ADD COLUMN "warehouseId" TEXT;

CREATE INDEX "InboundInvoice_warehouseId_idx"
  ON "InboundInvoice"("warehouseId");

ALTER TABLE "InboundInvoice"
  ADD CONSTRAINT "InboundInvoice_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Client-approved operational display capacity for the standard 40-ft
-- container. Unit-volume calculations intentionally continue to use 69 m³.
UPDATE "TransportType"
SET "payloadM3" = 71,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'KONTEJNER_40';
