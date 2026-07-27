ALTER TABLE "Product"
  ADD COLUMN "lastSupplierStockSyncAt" TIMESTAMP(3);

CREATE INDEX "Product_supplierId_lastSupplierStockSyncAt_idx"
  ON "Product"("supplierId", "lastSupplierStockSyncAt");
