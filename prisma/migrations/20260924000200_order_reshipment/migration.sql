CREATE TABLE "OrderReshipment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sourceShipmentId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "codAmount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderReshipment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OrderReshipmentItem" (
  "id" TEXT NOT NULL,
  "reshipmentId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "receivedQty" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "OrderReshipmentItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderReshipmentItem_quantity_check" CHECK ("quantity" > 0 AND "receivedQty" >= 0 AND "receivedQty" <= "quantity")
);
CREATE UNIQUE INDEX "OrderReshipment_sourceShipmentId_key" ON "OrderReshipment"("sourceShipmentId");
CREATE INDEX "OrderReshipment_orderId_idx" ON "OrderReshipment"("orderId");
CREATE INDEX "OrderReshipment_batchId_idx" ON "OrderReshipment"("batchId");
CREATE UNIQUE INDEX "OrderReshipmentItem_reshipmentId_orderItemId_key" ON "OrderReshipmentItem"("reshipmentId", "orderItemId");
ALTER TABLE "OrderReshipment" ADD CONSTRAINT "OrderReshipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderReshipment" ADD CONSTRAINT "OrderReshipment_sourceShipmentId_fkey" FOREIGN KEY ("sourceShipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderReshipment" ADD CONSTRAINT "OrderReshipment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PickupBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderReshipmentItem" ADD CONSTRAINT "OrderReshipmentItem_reshipmentId_fkey" FOREIGN KEY ("reshipmentId") REFERENCES "OrderReshipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderReshipment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderReshipmentItem" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "OrderReshipment", "OrderReshipmentItem" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "OrderReshipment", "OrderReshipmentItem" FROM authenticated;
  END IF;
END $$;
