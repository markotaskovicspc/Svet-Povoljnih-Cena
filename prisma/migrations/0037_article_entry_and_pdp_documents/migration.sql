-- Product documents keep the existing supplier-owned rows intact while
-- allowing administrators to attach multiple files to individual PDP sections.
ALTER TYPE "ProductAttachmentKind" ADD VALUE IF NOT EXISTS 'DOCUMENT';

CREATE TYPE "ProductAttachmentSection" AS ENUM (
  'GENERAL',
  'DELIVERY_TERMS',
  'DECLARATION',
  'ASSEMBLY_INSTRUCTIONS',
  'MAINTENANCE'
);

CREATE TYPE "ProductAttachmentOrigin" AS ENUM ('SUPPLIER', 'ADMIN_UPLOAD');

ALTER TABLE "ProductAttachment"
  ADD COLUMN "section" "ProductAttachmentSection" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "origin" "ProductAttachmentOrigin" NOT NULL DEFAULT 'SUPPLIER',
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "sizeBytes" INTEGER;

DROP INDEX IF EXISTS "ProductAttachment_productId_kind_order_key";
DROP INDEX IF EXISTS "ProductAttachment_productId_order_idx";

CREATE UNIQUE INDEX "ProductAttachment_productId_section_kind_order_key"
  ON "ProductAttachment"("productId", "section", "kind", "order");

CREATE INDEX "ProductAttachment_productId_section_order_idx"
  ON "ProductAttachment"("productId", "section", "order");

-- Product.sku remains immutable after creation. This database guard closes the
-- race between two administrators entering the same code with different case.
CREATE UNIQUE INDEX "Product_sku_case_insensitive_key"
  ON "Product"(lower("sku"));

CREATE OR REPLACE FUNCTION "prevent_product_sku_update"()
RETURNS trigger AS $$
BEGIN
  IF NEW."sku" IS DISTINCT FROM OLD."sku" THEN
    RAISE EXCEPTION 'Product SKU is immutable after creation.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Product_sku_immutable"
BEFORE UPDATE OF "sku" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "prevent_product_sku_update"();
