-- Existing products keep their current "Novo" state. Only rows inserted after
-- this migration default to an automatic four-calendar-month window.
ALTER TABLE "Product"
ADD COLUMN "newUntilAutomatic" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Product"
SET "newUntilAutomatic" = false;

CREATE INDEX "Product_newUntil_idx" ON "Product"("newUntil");

-- Product.createdAt is stored as a UTC timestamp without a time zone. Convert
-- that instant to the Belgrade business date before adding calendar months.
-- PostgreSQL clamps month-end values (for example 31 October + 4 months) to
-- the last valid day of February.
CREATE OR REPLACE FUNCTION "derive_product_is_new"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
    AND NEW."newUntilAutomatic" = true
    AND NEW."newUntil" IS NULL THEN
    NEW."newUntil" := (
      (
        NEW."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade'
      )::date + INTERVAL '4 months'
    )::date;
  END IF;

  NEW."isNew" := NEW."newUntil" IS NOT NULL
    AND NEW."newUntil"::date >= (
      CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Belgrade'
    )::date;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "Product_is_new_from_new_until" ON "Product";
CREATE TRIGGER "Product_is_new_from_new_until"
BEFORE INSERT OR UPDATE OF "newUntil", "newUntilAutomatic", "isNew" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "derive_product_is_new"();
