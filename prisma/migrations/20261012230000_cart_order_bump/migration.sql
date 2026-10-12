ALTER TYPE "AnalyticsEventType" ADD VALUE IF NOT EXISTS 'ORDER_BUMP';

ALTER TABLE "OrderItem"
  ADD COLUMN "orderBumpOfferId" VARCHAR(160),
  ADD COLUMN "orderBumpSourceSku" VARCHAR(64),
  ADD COLUMN "orderBumpQuantity" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "OrderItem_orderBumpOfferId_idx" ON "OrderItem"("orderBumpOfferId");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderBumpQuantity_check"
  CHECK ("orderBumpQuantity" >= 0 AND "orderBumpQuantity" <= 99);
