INSERT INTO "Group" ("id", "slug", "name")
VALUES (
  'grp-trpezarijske-stolice-i-stolovi',
  'trpezarijske-stolice-i-stolovi',
  'Trpezarijske stolice i stolovi'
)
ON CONFLICT ("slug") DO UPDATE
SET "name" = EXCLUDED."name";

UPDATE "ProductAttachment" AS attachment
SET "label" = product."sku" || ' ' || CASE attachment."section"
  WHEN 'DELIVERY_TERMS' THEN 'uslovi isporuke'
  WHEN 'DECLARATION' THEN 'deklaracija'
  WHEN 'ASSEMBLY_INSTRUCTIONS' THEN 'uputstvo za sastavljanje'
  WHEN 'MAINTENANCE' THEN 'kako održavati'
  ELSE attachment."label"
END
FROM "Product" AS product
WHERE attachment."productId" = product."id"
  AND attachment."origin" = 'ADMIN_UPLOAD'
  AND attachment."section" IN (
    'DELIVERY_TERMS',
    'DECLARATION',
    'ASSEMBLY_INSTRUCTIONS',
    'MAINTENANCE'
  );
