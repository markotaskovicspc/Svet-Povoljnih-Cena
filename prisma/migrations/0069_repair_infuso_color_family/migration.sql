-- Repair the two INFUSO colour members without touching their SKU-specific
-- prices, promotions, stock, media, supplier ownership or order history.
-- The guards make this migration idempotent and a no-op outside the affected
-- catalog.
DO $$
DECLARE
  black_product_id TEXT;
  white_product_id TEXT;
  infuso_family_id TEXT;
BEGIN
  SELECT p."id", pfm."familyId"
    INTO black_product_id, infuso_family_id
  FROM "Product" p
  JOIN "ProductFamilyMember" pfm ON pfm."productId" = p."id"
  JOIN "ProductFamily" pf ON pf."id" = pfm."familyId"
  WHERE p."sku" = '210011'
    AND p."name" ILIKE '%INFUSO%'
    AND pf."code" = '210011'
  LIMIT 1;

  SELECT p."id"
    INTO white_product_id
  FROM "Product" p
  JOIN "ProductFamilyMember" pfm ON pfm."productId" = p."id"
  WHERE p."sku" = '210012'
    AND p."name" ILIKE '%INFUSO%'
    AND pfm."familyId" = infuso_family_id
  LIMIT 1;

  IF black_product_id IS NULL OR white_product_id IS NULL OR infuso_family_id IS NULL THEN
    RAISE NOTICE 'INFUSO family repair skipped: guarded products were not found.';
    RETURN;
  END IF;

  UPDATE "Product"
  SET "colorPrimary" = 'crna', "colorSecondary" = NULL
  WHERE "id" = black_product_id;

  UPDATE "Product"
  SET "colorPrimary" = 'bela', "colorSecondary" = NULL
  WHERE "id" = white_product_id;

  -- Update white first because the broken data currently uses CRNA on this
  -- member and the family has a unique (familyId, labelKey) constraint.
  UPDATE "ProductFamilyMember"
  SET "label" = 'Bela',
      "labelKey" = 'bela',
      "position" = 1,
      "storefrontEnabled" = TRUE
  WHERE "productId" = white_product_id;

  UPDATE "ProductFamilyMember"
  SET "label" = 'Crna',
      "labelKey" = 'crna',
      "position" = 0,
      "storefrontEnabled" = TRUE
  WHERE "productId" = black_product_id;

  UPDATE "ProductFamily"
  SET "primaryProductId" = black_product_id
  WHERE "id" = infuso_family_id;
END $$;
