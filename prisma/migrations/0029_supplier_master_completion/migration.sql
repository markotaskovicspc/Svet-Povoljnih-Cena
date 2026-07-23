-- Persist automatic supplier codes for legacy records that predate ERP module 2.
BEGIN;

LOCK TABLE "Supplier" IN SHARE ROW EXCLUSIVE MODE;

WITH "currentMax" AS (
  SELECT COALESCE(
    MAX(SUBSTRING("code" FROM '^DOB-([0-9]+)$')::INTEGER),
    0
  ) AS "lastValue"
  FROM "Supplier"
  WHERE "code" ~ '^DOB-[0-9]+$'
),
"pending" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, "id" ASC) AS "offset"
  FROM "Supplier"
  WHERE "code" IS NULL
)
UPDATE "Supplier" AS supplier
SET "code" =
  'DOB-' ||
  LPAD(
    ("currentMax"."lastValue" + "pending"."offset")::TEXT,
    GREATEST(
      4,
      LENGTH(("currentMax"."lastValue" + "pending"."offset")::TEXT)
    ),
    '0'
  )
FROM "pending", "currentMax"
WHERE supplier."id" = "pending"."id";

COMMIT;
