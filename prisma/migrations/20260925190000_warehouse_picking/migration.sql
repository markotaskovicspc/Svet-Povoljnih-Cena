CREATE TABLE "WarehousePickingPosition" (
 "id" TEXT PRIMARY KEY, "warehouseId" TEXT NOT NULL REFERENCES "Warehouse"("id") ON DELETE RESTRICT,
 "number" INTEGER NOT NULL CHECK ("number" BETWEEN 1 AND 240),
 "routeOrder" INTEGER NOT NULL CHECK ("routeOrder" BETWEEN 1 AND 10000),
 "skus" TEXT[] NOT NULL DEFAULT '{}', "supplierIds" TEXT[] NOT NULL DEFAULT '{}',
 "note" TEXT NOT NULL DEFAULT '', "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WarehousePickingPosition_warehouseId_number_key" UNIQUE ("warehouseId", "number")
);
CREATE TABLE "PickingScanEvent" (
 "id" TEXT PRIMARY KEY, "batchId" TEXT NOT NULL REFERENCES "PickupBatch"("id") ON DELETE RESTRICT,
 "planHash" TEXT NOT NULL, "rowKey" TEXT NOT NULL, "delta" INTEGER NOT NULL,
 "note" TEXT NOT NULL DEFAULT '', "actorId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PickingScanEvent_batchId_planHash_idx" ON "PickingScanEvent"("batchId", "planHash");
ALTER TABLE "WarehousePickingPosition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PickingScanEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WarehousePickingPosition", "PickingScanEvent" FROM anon, authenticated;
