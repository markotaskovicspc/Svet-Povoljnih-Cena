-- Keep the ERP customer master in sync with every registered account and web
-- order. Runtime writes use the same deterministic IDs, so this backfill is
-- idempotent and safe to re-run while old application instances are serving.

-- If a guest later registered with the same normalized email (or phone when
-- email is absent), adopt that guest customer instead of creating a duplicate.
WITH registered_identity AS (
  SELECT
    u."id" AS user_id,
    COALESCE(
      NULLIF(lower(trim(u."email")), ''),
      NULLIF(regexp_replace(u."phone", '[^0-9+]', '', 'g'), '')
    ) AS identity
  FROM "User" u
  WHERE u."deletedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Customer" existing WHERE existing."userId" = u."id"
    )
)
UPDATE "Customer" c
SET
  "userId" = r.user_id,
  "updatedAt" = CURRENT_TIMESTAMP
FROM registered_identity r
WHERE r.identity IS NOT NULL
  AND c."id" = CONCAT('erp-customer-guest-', md5(r.identity))
  AND c."userId" IS NULL;

-- Create a canonical customer for every remaining registered account.
INSERT INTO "Customer" (
  "id",
  "userId",
  "firstName",
  "lastName",
  "companyName",
  "pib",
  "phone",
  "email",
  "gender",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('erp-customer-user-', md5(u."id")),
  u."id",
  u."firstName",
  u."lastName",
  u."companyName",
  u."pib",
  u."phone",
  lower(trim(u."email")),
  'NEPOZNATO'::"CustomerGender",
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."deletedAt" IS NULL
ON CONFLICT DO NOTHING;

-- Refresh non-empty account fields without erasing checkout address data.
UPDATE "Customer" c
SET
  "firstName" = COALESCE(NULLIF(trim(u."firstName"), ''), c."firstName"),
  "lastName" = COALESCE(NULLIF(trim(u."lastName"), ''), c."lastName"),
  "companyName" = COALESCE(NULLIF(trim(u."companyName"), ''), c."companyName"),
  "pib" = COALESCE(NULLIF(trim(u."pib"), ''), c."pib"),
  "phone" = COALESCE(NULLIF(trim(u."phone"), ''), c."phone"),
  "email" = COALESCE(NULLIF(lower(trim(u."email")), ''), c."email"),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "User" u
WHERE c."userId" = u."id"
  AND u."deletedAt" IS NULL;

UPDATE "Order" o
SET "customerId" = c."id"
FROM "Customer" c
WHERE o."userId" = c."userId"
  AND o."customerId" IS NULL;

-- A registered account may only contain an email. Complete its customer
-- master from the latest checkout snapshot, matching the runtime behavior.
WITH latest_registered_order AS (
  SELECT DISTINCT ON (o."userId")
    o."userId",
    o."shipFirstName",
    o."shipLastName",
    o."shipCompanyName",
    o."shipPib",
    o."shipStreet",
    o."shipCity",
    o."shipPostalCode",
    o."shipCountry",
    o."shipPhone"
  FROM "Order" o
  WHERE o."userId" IS NOT NULL
  ORDER BY o."userId", o."createdAt" DESC
)
UPDATE "Customer" c
SET
  "firstName" = COALESCE(NULLIF(trim(o."shipFirstName"), ''), c."firstName"),
  "lastName" = COALESCE(NULLIF(trim(o."shipLastName"), ''), c."lastName"),
  "companyName" = COALESCE(NULLIF(trim(o."shipCompanyName"), ''), c."companyName"),
  "pib" = COALESCE(NULLIF(trim(o."shipPib"), ''), c."pib"),
  "address" = COALESCE(NULLIF(trim(o."shipStreet"), ''), c."address"),
  "city" = COALESCE(NULLIF(trim(o."shipCity"), ''), c."city"),
  "postalCode" = COALESCE(NULLIF(trim(o."shipPostalCode"), ''), c."postalCode"),
  "country" = COALESCE(NULLIF(trim(o."shipCountry"), ''), c."country"),
  "phone" = COALESCE(NULLIF(trim(o."shipPhone"), ''), c."phone"),
  "updatedAt" = CURRENT_TIMESTAMP
FROM latest_registered_order o
WHERE c."userId" = o."userId";

-- Guest orders share one deterministic customer by normalized email, falling
-- back to normalized phone only when email is absent.
WITH guest_identity AS (
  SELECT DISTINCT ON (
    COALESCE(
      NULLIF(lower(trim(o."guestEmail")), ''),
      NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')
    )
  )
    COALESCE(
      NULLIF(lower(trim(o."guestEmail")), ''),
      NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')
    ) AS identity,
    o."shipFirstName",
    o."shipLastName",
    o."shipCompanyName",
    o."shipPib",
    o."shipStreet",
    o."shipCity",
    o."shipPostalCode",
    o."shipCountry",
    o."shipPhone",
    lower(trim(o."guestEmail")) AS email,
    o."createdAt"
  FROM "Order" o
  WHERE o."userId" IS NULL
    AND o."channel" = 'WEB'::"SalesChannel"
    AND o."customerId" IS NULL
    AND COALESCE(
      NULLIF(lower(trim(o."guestEmail")), ''),
      NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')
    ) IS NOT NULL
  ORDER BY
    COALESCE(
      NULLIF(lower(trim(o."guestEmail")), ''),
      NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')
    ),
    o."createdAt" DESC
)
INSERT INTO "Customer" (
  "id",
  "firstName",
  "lastName",
  "companyName",
  "pib",
  "address",
  "city",
  "postalCode",
  "country",
  "phone",
  "email",
  "gender",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('erp-customer-guest-', md5(g.identity)),
  g."shipFirstName",
  g."shipLastName",
  g."shipCompanyName",
  g."shipPib",
  g."shipStreet",
  g."shipCity",
  g."shipPostalCode",
  g."shipCountry",
  g."shipPhone",
  g.email,
  'NEPOZNATO'::"CustomerGender",
  g."createdAt",
  CURRENT_TIMESTAMP
FROM guest_identity g
ON CONFLICT ("id") DO UPDATE SET
  "firstName" = COALESCE(NULLIF(trim(EXCLUDED."firstName"), ''), "Customer"."firstName"),
  "lastName" = COALESCE(NULLIF(trim(EXCLUDED."lastName"), ''), "Customer"."lastName"),
  "companyName" = COALESCE(NULLIF(trim(EXCLUDED."companyName"), ''), "Customer"."companyName"),
  "pib" = COALESCE(NULLIF(trim(EXCLUDED."pib"), ''), "Customer"."pib"),
  "address" = COALESCE(NULLIF(trim(EXCLUDED."address"), ''), "Customer"."address"),
  "city" = COALESCE(NULLIF(trim(EXCLUDED."city"), ''), "Customer"."city"),
  "postalCode" = COALESCE(NULLIF(trim(EXCLUDED."postalCode"), ''), "Customer"."postalCode"),
  "country" = COALESCE(NULLIF(trim(EXCLUDED."country"), ''), "Customer"."country"),
  "phone" = COALESCE(NULLIF(trim(EXCLUDED."phone"), ''), "Customer"."phone"),
  "email" = COALESCE(NULLIF(lower(trim(EXCLUDED."email")), ''), "Customer"."email"),
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Order" o
SET "customerId" = CONCAT(
  'erp-customer-guest-',
  md5(COALESCE(
    NULLIF(lower(trim(o."guestEmail")), ''),
    NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')
  ))
)
WHERE o."userId" IS NULL
  AND o."channel" = 'WEB'::"SalesChannel"
  AND o."customerId" IS NULL
  AND COALESCE(
    NULLIF(lower(trim(o."guestEmail")), ''),
    NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')
  ) IS NOT NULL;
