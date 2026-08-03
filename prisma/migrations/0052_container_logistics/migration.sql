ALTER TABLE "Product"
  ADD COLUMN "containerQty" INTEGER,
  ADD COLUMN "containerGrossWeightKg" DECIMAL(12,3);

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_containerQty_positive"
    CHECK ("containerQty" IS NULL OR "containerQty" > 0),
  ADD CONSTRAINT "Product_containerGrossWeightKg_positive"
    CHECK ("containerGrossWeightKg" IS NULL OR "containerGrossWeightKg" > 0);
