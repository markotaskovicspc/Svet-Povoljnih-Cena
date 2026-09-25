ALTER TABLE "Product" ADD COLUMN "courierUnitsPerBox" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Product" ADD CONSTRAINT "Product_courierUnitsPerBox_positive" CHECK ("courierUnitsPerBox" > 0);
ALTER TABLE "PickupBatchLine" ADD COLUMN "packedQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PickupBatchLine" ADD CONSTRAINT "PickupBatchLine_packedQuantity_positive" CHECK ("packedQuantity" > 0);
