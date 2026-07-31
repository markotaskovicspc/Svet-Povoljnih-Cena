-- Administrators may reuse the codes printed on existing warehouse labels.
-- Case-insensitive uniqueness remains enforced by Product_sku_case_insensitive_key;
-- application transactions additionally reject numerically equivalent dotted codes.
DROP TRIGGER IF EXISTS "Product_sku_immutable" ON "Product";
DROP FUNCTION IF EXISTS "prevent_product_sku_update"();
