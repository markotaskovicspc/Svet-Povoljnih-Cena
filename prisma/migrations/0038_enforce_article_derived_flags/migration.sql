-- "Novo" is a derived status. Legacy standalone flags and T&C dates outside
-- the permanent-low-price status are normalized before the write guard lands.
UPDATE "Product"
SET "isNew" = CASE
  WHEN "newUntil" IS NOT NULL AND "newUntil" >= CURRENT_DATE THEN TRUE
  ELSE FALSE
END;

UPDATE "Product"
SET "tncFrom" = NULL,
    "tncUntil" = NULL
WHERE "articleStatus" <> 'DTZ';

CREATE OR REPLACE FUNCTION "derive_product_is_new"()
RETURNS trigger AS $$
BEGIN
  NEW."isNew" := NEW."newUntil" IS NOT NULL AND NEW."newUntil" >= CURRENT_DATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Product_is_new_from_new_until" ON "Product";
CREATE TRIGGER "Product_is_new_from_new_until"
BEFORE INSERT OR UPDATE OF "newUntil", "isNew" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "derive_product_is_new"();

CREATE OR REPLACE FUNCTION "normalize_product_tnc_dates"()
RETURNS trigger AS $$
BEGIN
  IF NEW."articleStatus" <> 'DTZ' THEN
    NEW."tncFrom" := NULL;
    NEW."tncUntil" := NULL;
  ELSIF NEW."tncFrom" IS NOT NULL
    AND NEW."tncUntil" IS NOT NULL
    AND NEW."tncFrom" > NEW."tncUntil" THEN
    RAISE EXCEPTION 'T&C datum od ne može biti posle datuma do.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Product_normalize_tnc_dates" ON "Product";
CREATE TRIGGER "Product_normalize_tnc_dates"
BEFORE INSERT OR UPDATE OF "articleStatus", "tncFrom", "tncUntil" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "normalize_product_tnc_dates"();
