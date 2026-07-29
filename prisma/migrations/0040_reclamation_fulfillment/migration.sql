-- Quantity-aware reclamations and explicit return/replacement shipment links.
CREATE TYPE "ShipmentPurpose" AS ENUM (
  'ORDER_DELIVERY',
  'RECLAMATION_RETURN',
  'RECLAMATION_REPLACEMENT'
);

CREATE TYPE "ReclamationWarehouseStatus" AS ENUM (
  'NOT_REQUESTED',
  'REQUESTED',
  'PREPARING',
  'READY',
  'HANDED_OVER',
  'CANCELLED'
);

ALTER TABLE "Shipment"
  ADD COLUMN "reclamationId" TEXT,
  ADD COLUMN "warehouseId" TEXT,
  ADD COLUMN "purpose" "ShipmentPurpose" NOT NULL DEFAULT 'ORDER_DELIVERY',
  ADD COLUMN "reclamationQty" INTEGER;

ALTER TABLE "Reclamation"
  ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "warehouseId" TEXT,
  ADD COLUMN "warehouseStatus" "ReclamationWarehouseStatus" NOT NULL DEFAULT 'NOT_REQUESTED';

ALTER TABLE "Shipment"
  ADD CONSTRAINT "Shipment_reclamationId_fkey"
  FOREIGN KEY ("reclamationId") REFERENCES "Reclamation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Shipment_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Shipment_reclamationQty_check"
  CHECK ("reclamationQty" IS NULL OR "reclamationQty" > 0);

ALTER TABLE "Reclamation"
  ADD CONSTRAINT "Reclamation_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Reclamation_quantity_check"
  CHECK ("quantity" > 0);

CREATE UNIQUE INDEX "Shipment_reclamationId_purpose_key"
  ON "Shipment"("reclamationId", "purpose");
CREATE INDEX "Shipment_reclamationId_purpose_idx"
  ON "Shipment"("reclamationId", "purpose");
CREATE INDEX "Shipment_warehouseId_purpose_idx"
  ON "Shipment"("warehouseId", "purpose");
CREATE INDEX "Reclamation_warehouseId_warehouseStatus_idx"
  ON "Reclamation"("warehouseId", "warehouseStatus");
