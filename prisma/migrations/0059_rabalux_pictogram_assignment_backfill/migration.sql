-- The live Rabalux catalog credential can be unavailable independently of the
-- stock API credential. Backfill the newly seeded pictograms from the latest
-- structured technical data already stored on products. Future catalog syncs
-- remain authoritative and idempotently maintain these managed relations.
WITH rabalux_products AS (
  SELECT product."id", product."technicalSpecs"
  FROM "Product" AS product
  JOIN "Supplier" AS supplier ON supplier."id" = product."supplierId"
  WHERE supplier."integrationKey" = 'RABALUX'
    AND product."deletedAt" IS NULL
    AND product."supplierExternalId" IS NOT NULL
    AND NOT (
      COALESCE(product."syncOverrides"->'fields', '[]'::jsonb) ? 'pictograms'
    )
), specs AS (
  SELECT
    product."id" AS "productId",
    spec->>'key' AS "key",
    LOWER(TRIM(COALESCE(spec->>'value', ''))) AS "value"
  FROM rabalux_products AS product
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(product."technicalSpecs") = 'array'
        THEN product."technicalSpecs"
      ELSE '[]'::jsonb
    END
  ) AS spec
), candidates AS (
  SELECT "productId", 'rabalux-color-temperature' AS code, 8 AS priority
  FROM specs WHERE "key" = 'Color_temp_change' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-rgb', 9
  FROM specs WHERE "key" = 'RGB' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-memory', 10
  FROM specs WHERE "key" = 'Memory_function' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-timer', 11
  FROM specs WHERE "key" = 'Timer_function' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-nightlight', 12
  FROM specs WHERE "key" = 'Nightlight' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-own-design', 13
  FROM specs WHERE "key" = 'Rabalux_own_design' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-starry-effect', 14
  FROM specs WHERE "key" = 'Starry_effect' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-backlight', 15
  FROM specs WHERE "key" = 'Backlight' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-textile-cable', 16
  FROM specs WHERE "key" = 'Textile_cable' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-bluetooth', 17
  FROM specs WHERE "key" = 'Bluetooth' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-usb-port', 18
  FROM specs WHERE "key" = 'USB_charging_port' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-usb-charging', 19
  FROM specs WHERE "key" = 'Chargeable_w_USB' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-speaker', 20
  FROM specs WHERE "key" = 'Speaker' AND "value" IN ('1', 'da', 'yes', 'true')
  UNION ALL
  SELECT "productId", 'rabalux-microwave-sensor', 21
  FROM specs WHERE "key" = 'Sensor_type' AND "value" LIKE '%mikrotalas%'
  UNION ALL
  SELECT "productId", 'rabalux-motion-sensor', 22
  FROM specs
  WHERE "key" = 'Sensor_type'
    AND ("value" LIKE '%pokret%' OR "value" LIKE '%pir%')
    AND "value" NOT LIKE '%mikrotalas%'
  UNION ALL
  SELECT "productId", 'rabalux-light-sensor', 23
  FROM specs
  WHERE "key" = 'Sensor_type'
    AND ("value" LIKE '%svetlos%' OR "value" LIKE '%svjetlos%')
  UNION ALL
  SELECT "productId", 'rabalux-solar', 24
  FROM specs WHERE "key" = 'Other_functions' AND "value" LIKE '%solarn%'
  UNION ALL
  SELECT "productId", 'rabalux-wireless-charging', 25
  FROM specs
  WHERE "key" = 'Other_functions'
    AND ("value" LIKE '%bežičn%' OR "value" LIKE '%bezicn%')
    AND "value" LIKE '%punj%'
  UNION ALL
  SELECT "productId", 'rabalux-fan', 26
  FROM specs WHERE "key" = 'Other_functions' AND "value" LIKE '%fan motor%'
  UNION ALL
  SELECT "productId", 'rabalux-battery', 27
  FROM specs
  WHERE "key" = 'Battery' AND "value" <> '' AND "value" NOT LIKE '%excl%'
), unique_candidates AS (
  SELECT DISTINCT "productId", code, priority FROM candidates
), existing_managed AS (
  SELECT relation."productId", COUNT(*)::integer AS count
  FROM "ProductPictogram" AS relation
  JOIN "Pictogram" AS pictogram ON pictogram."id" = relation."pictogramId"
  WHERE pictogram."code" LIKE 'rabalux-%'
  GROUP BY relation."productId"
), ranked AS (
  SELECT
    candidate.*,
    ROW_NUMBER() OVER (
      PARTITION BY candidate."productId"
      ORDER BY candidate.priority, candidate.code
    ) AS rank
  FROM unique_candidates AS candidate
)
INSERT INTO "ProductPictogram" ("productId", "pictogramId")
SELECT ranked."productId", pictogram."id"
FROM ranked
JOIN "Pictogram" AS pictogram ON pictogram."code" = ranked.code
LEFT JOIN existing_managed
  ON existing_managed."productId" = ranked."productId"
WHERE ranked.rank <= GREATEST(6 - COALESCE(existing_managed.count, 0), 0)
ON CONFLICT ("productId", "pictogramId") DO NOTHING;
