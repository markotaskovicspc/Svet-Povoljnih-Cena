-- Preserve fields present in manual Excel catalog imports.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeLabel" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "colorPrimary" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "colorSecondary" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Product_barcode_key" ON "Product"("barcode");
