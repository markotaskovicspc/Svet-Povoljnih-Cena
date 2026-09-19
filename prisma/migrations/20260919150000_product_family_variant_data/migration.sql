-- Existing color families keep their current editing behavior.
-- Linking existing size/SKU variants explicitly opts the family into independent data.
ALTER TABLE "ProductFamily" ADD COLUMN "preserveVariantData" BOOLEAN NOT NULL DEFAULT false;
