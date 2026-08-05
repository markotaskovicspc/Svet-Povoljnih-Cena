ALTER TABLE "Product"
ADD COLUMN "firstPublishedAt" TIMESTAMP(3);

-- Publication is the first time the catalog record becomes active. Keep that
-- timestamp forever so archiving/reactivation cannot silently renew "Novo".
CREATE OR REPLACE FUNCTION "derive_product_is_new"()
RETURNS trigger AS $$
BEGIN
  IF NEW."isActive" = true AND NEW."firstPublishedAt" IS NULL THEN
    NEW."firstPublishedAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
  END IF;

  IF NEW."newUntilAutomatic" = true THEN
    IF NEW."firstPublishedAt" IS NULL THEN
      NEW."newUntil" := NULL;
    ELSE
      NEW."newUntil" := (
        (
          NEW."firstPublishedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade'
        )::date + INTERVAL '4 months'
      )::date;
    END IF;
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
BEFORE INSERT OR UPDATE OF
  "isActive",
  "firstPublishedAt",
  "newUntil",
  "newUntilAutomatic",
  "isNew"
ON "Product"
FOR EACH ROW EXECUTE FUNCTION "derive_product_is_new"();

-- Client decision (2026-08-05): every currently published product starts a
-- fresh four-month window today. Drafts wait for their first publication.
UPDATE "Product"
SET "firstPublishedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
    "newUntilAutomatic" = true,
    "newUntil" = NULL,
    "isNew" = false
WHERE "isActive" = true;

UPDATE "Product"
SET "firstPublishedAt" = NULL,
    "newUntilAutomatic" = true,
    "newUntil" = NULL,
    "isNew" = false
WHERE "isActive" = false
  AND "articleStatus" <> 'ARH';
