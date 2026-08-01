-- Loyalty is a catalog-wide benefit for authenticated customers. Product
-- memberships remain in place for backward compatibility but are no longer
-- used by pricing or the admin editor.
ALTER TABLE "LoyaltyRule"
  ALTER COLUMN "scope" SET DEFAULT 'ALL_PRODUCTS';

UPDATE "LoyaltyRule"
SET "scope" = 'ALL_PRODUCTS'
WHERE "scope" <> 'ALL_PRODUCTS';
