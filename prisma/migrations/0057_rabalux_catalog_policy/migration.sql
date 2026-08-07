-- Rabalux products are supplier-catalog items, never automatic "Novo" or
-- "Dok traju zalihe" promotions. Restricted status remains untouched here.
UPDATE "Product" AS product
SET
  "isNew" = false,
  "newUntil" = NULL,
  "newUntilAutomatic" = false,
  "isDtz" = false,
  "articleStatus" = CASE
    WHEN product."articleStatus" = 'DTZ' THEN 'SP'::"ArticleStatus"
    ELSE product."articleStatus"
  END
FROM "Supplier" AS supplier
WHERE supplier."id" = product."supplierId"
  AND supplier."integrationKey" = 'RABALUX';

-- Keep every existing document, including admin uploads, but move legacy
-- GENERAL documents into the PDP assembly-instructions section. A high,
-- product-local order avoids colliding with manually ordered attachments.
WITH moving AS (
  SELECT
    attachment."id",
    attachment."productId",
    ROW_NUMBER() OVER (
      PARTITION BY attachment."productId"
      ORDER BY attachment."createdAt", attachment."id"
    ) AS row_number
  FROM "ProductAttachment" AS attachment
  JOIN "Product" AS product ON product."id" = attachment."productId"
  JOIN "Supplier" AS supplier ON supplier."id" = product."supplierId"
  WHERE supplier."integrationKey" = 'RABALUX'
    AND attachment."section" = 'GENERAL'
), product_max_order AS (
  SELECT "productId", COALESCE(MAX("order"), 0) + 1000 AS base_order
  FROM "ProductAttachment"
  GROUP BY "productId"
)
UPDATE "ProductAttachment" AS attachment
SET
  "section" = 'ASSEMBLY_INSTRUCTIONS'::"ProductAttachmentSection",
  "order" = (product_max_order.base_order + moving.row_number)::INTEGER
FROM moving
JOIN product_max_order ON product_max_order."productId" = moving."productId"
WHERE attachment."id" = moving."id";

-- Seed the stable library entries. Product links are derived idempotently by
-- the catalog sync from structured feed fields and respect manual overrides.
INSERT INTO "Pictogram" ("id", "code", "label", "iconUrl") VALUES
  ('rabalux-pictogram-warranty-5', 'rabalux-warranty-5', '5 godina garancije', '/brand/pictograms/rabalux/warranty-5.png'),
  ('rabalux-pictogram-warranty-3', 'rabalux-warranty-3', '3 godine garancije', '/brand/pictograms/rabalux/warranty-3.png'),
  ('rabalux-pictogram-led', 'rabalux-led', 'LED tehnologija', '/brand/pictograms/rabalux/led.png'),
  ('rabalux-pictogram-dimmable', 'rabalux-dimmable', 'Prigušivanje', '/brand/pictograms/rabalux/dimmable.png'),
  ('rabalux-pictogram-remote', 'rabalux-remote', 'Daljinski upravljač', '/brand/pictograms/rabalux/remote-control.png'),
  ('rabalux-pictogram-smart', 'rabalux-smart', 'Smart / Wi‑Fi', '/brand/pictograms/rabalux/smart-wifi.png'),
  ('rabalux-pictogram-ip44-plus', 'rabalux-ip44-plus', 'IP44 ili viša zaštita', '/brand/pictograms/rabalux/ip44-plus.png')
ON CONFLICT ("code") DO UPDATE SET
  "label" = EXCLUDED."label",
  "iconUrl" = EXCLUDED."iconUrl";
