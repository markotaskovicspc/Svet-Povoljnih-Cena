-- Freight is part of landed cost and must be allocated to received lines so
-- weighted-average COGS remains auditable.

ALTER TABLE "PurchaseOrder"
  ADD COLUMN "freightCost" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "PurchaseOrderItem"
  ADD COLUMN "freightAllocated" DECIMAL(12,2);
