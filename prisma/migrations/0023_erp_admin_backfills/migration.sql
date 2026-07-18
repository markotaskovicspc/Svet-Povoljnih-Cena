-- Preserve the storefront-facing article state while normalising the legacy
-- flags into the six documented ERP statuses.
UPDATE "Product"
SET "articleStatus" = CASE
  WHEN "deletedAt" IS NOT NULL THEN 'ARH'::"ArticleStatus"
  WHEN "isDtz" = true THEN 'DTZ'::"ArticleStatus"
  WHEN "isLimited" = true THEN 'IT'::"ArticleStatus"
  WHEN "isActive" = false THEN 'UZ'::"ArticleStatus"
  WHEN "supplierId" IS NOT NULL THEN 'DOB'::"ArticleStatus"
  ELSE 'SP'::"ArticleStatus"
END;

-- Existing product-level action prices become explicit action/product rows.
-- The original Product fields remain untouched for backwards compatibility.
INSERT INTO "ActionProduct" (
  "actionId",
  "productId",
  "salePrice",
  "createdAt",
  "updatedAt"
)
SELECT
  "actionId",
  "id",
  "salePrice",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product"
WHERE "actionId" IS NOT NULL
  AND "salePrice" IS NOT NULL
ON CONFLICT ("actionId", "productId") DO NOTHING;

-- Seed the canonical MP retail price list from current full prices without
-- changing Product.fullPrice or Product.salePrice.
INSERT INTO "PriceList" (
  "id",
  "code",
  "name",
  "kind",
  "currency",
  "active",
  "validFrom",
  "createdAt",
  "updatedAt"
)
VALUES (
  'erp-price-list-mp',
  'MP',
  'Maloprodajni cenovnik',
  'RETAIL'::"PriceListKind",
  'RSD'::"ErpCurrency",
  true,
  CURRENT_DATE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "PriceListEntry" (
  "id",
  "priceListId",
  "productId",
  "price",
  "validFrom",
  "createdAt",
  "updatedAt"
)
SELECT
  CONCAT('erp-mp-', md5(p."id")),
  pl."id",
  p."id",
  p."fullPrice",
  CURRENT_DATE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product" p
CROSS JOIN "PriceList" pl
WHERE pl."code" = 'MP'
ON CONFLICT ("priceListId", "productId", "validFrom") DO NOTHING;

-- Establish DC opening balances only where a warehouse/product row does not
-- already exist. Existing warehouse stock is authoritative and is never
-- overwritten.
INSERT INTO "WarehouseStock" (
  "id",
  "warehouseId",
  "productId",
  "qty",
  "updatedAt"
)
SELECT
  CONCAT('erp-opening-stock-', md5(w."id" || ':' || p."id")),
  w."id",
  p."id",
  p."stock",
  CURRENT_TIMESTAMP
FROM "Product" p
CROSS JOIN LATERAL (
  SELECT "id"
  FROM "Warehouse"
  WHERE "active" = true
  ORDER BY "isDefault" DESC, "createdAt" ASC
  LIMIT 1
) w
ON CONFLICT ("warehouseId", "productId") DO NOTHING;

INSERT INTO "StockMovement" (
  "id",
  "idempotencyKey",
  "warehouseId",
  "productId",
  "kind",
  "sku",
  "qty",
  "note",
  "balanceAfterWarehouse",
  "balanceAfterTotal",
  "createdAt"
)
SELECT
  CONCAT('erp-opening-movement-', md5(w."id" || ':' || p."id")),
  CONCAT('erp-opening:', w."id", ':', p."id"),
  w."id",
  p."id",
  'OPENING_BALANCE'::"StockMovementKind",
  p."sku",
  p."stock",
  'Početno stanje migrirano iz postojećeg lagera',
  p."stock",
  p."stock",
  CURRENT_TIMESTAMP
FROM "Product" p
CROSS JOIN LATERAL (
  SELECT "id"
  FROM "Warehouse"
  WHERE "active" = true
  ORDER BY "isDefault" DESC, "createdAt" ASC
  LIMIT 1
) w
ON CONFLICT ("idempotencyKey") DO NOTHING;

-- Canonical customers for registered users. Gender remains explicitly unknown;
-- it is never inferred from a name.
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
  lower(u."email"),
  'NEPOZNATO'::"CustomerGender",
  u."createdAt",
  CURRENT_TIMESTAMP
FROM "User" u
ON CONFLICT ("userId") DO NOTHING;

UPDATE "Order" o
SET
  "customerId" = c."id",
  "channel" = 'WEB'::"SalesChannel"
FROM "Customer" c
WHERE o."userId" = c."userId"
  AND o."customerId" IS NULL;

-- Guest orders are grouped by normalised email, or phone when email is absent.
WITH guest_identity AS (
  SELECT DISTINCT ON (
    COALESCE(NULLIF(lower(trim(o."guestEmail")), ''), NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), ''))
  )
    COALESCE(NULLIF(lower(trim(o."guestEmail")), ''), NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')) AS identity,
    o."shipFirstName",
    o."shipLastName",
    o."shipCompanyName",
    o."shipPib",
    o."shipStreet",
    o."shipCity",
    o."shipPostalCode",
    o."shipCountry",
    o."shipPhone",
    lower(o."guestEmail") AS email,
    o."createdAt"
  FROM "Order" o
  WHERE o."userId" IS NULL
    AND COALESCE(NULLIF(lower(trim(o."guestEmail")), ''), NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')) IS NOT NULL
  ORDER BY
    COALESCE(NULLIF(lower(trim(o."guestEmail")), ''), NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')),
    o."createdAt" ASC
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
ON CONFLICT ("id") DO NOTHING;

UPDATE "Order" o
SET
  "customerId" = CONCAT(
    'erp-customer-guest-',
    md5(COALESCE(NULLIF(lower(trim(o."guestEmail")), ''), NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')))
  ),
  "channel" = 'WEB'::"SalesChannel"
WHERE o."userId" IS NULL
  AND o."customerId" IS NULL
  AND COALESCE(NULLIF(lower(trim(o."guestEmail")), ''), NULLIF(regexp_replace(o."shipPhone", '[^0-9+]', '', 'g'), '')) IS NOT NULL;

-- Preserve invoice totals while introducing the split net/VAT/gross fields.
UPDATE "InboundInvoice"
SET
  "netValue" = "value",
  "grossValue" = "value"
WHERE "netValue" = 0
  AND "grossValue" = 0;

-- Safe defaults from the approved business rules.
INSERT INTO "AdminSetting" ("key", "value", "updatedAt")
VALUES
  ('pricing.maxCombinedDiscountPct', '30'::jsonb, CURRENT_TIMESTAMP),
  ('stock.safety.web', '0'::jsonb, CURRENT_TIMESTAMP),
  ('stock.safety.wholesale', '10'::jsonb, CURRENT_TIMESTAMP),
  ('stock.safety.export', '20'::jsonb, CURRENT_TIMESTAMP),
  ('reporting.timeZone', '"Europe/Belgrade"'::jsonb, CURRENT_TIMESTAMP),
  ('reporting.baseCurrency', '"RSD"'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "TransportType" (
  "id",
  "code",
  "name",
  "payloadKg",
  "payloadM3",
  "active",
  "createdAt",
  "updatedAt"
)
VALUES
  ('erp-transport-kombi', 'KOMBI', 'Kombi', 1200, 12, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('erp-transport-sleper', 'SLEPER', 'Šleper', 24000, 90, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('erp-transport-kontejner-40', 'KONTEJNER_40', 'Kontejner 40 ft', 26500, 67.7, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Provider rows deliberately begin as not configured; no placeholder action can
-- report success before a health check confirms credentials and contract data.
INSERT INTO "IntegrationHealth" (
  "provider",
  "status",
  "missingKeys",
  "message",
  "updatedAt"
)
VALUES
  ('SEF', 'NOT_CONFIGURED'::"IntegrationStatus", ARRAY[]::TEXT[], 'Provera konfiguracije nije pokrenuta.', CURRENT_TIMESTAMP),
  ('ANANAS', 'NOT_CONFIGURED'::"IntegrationStatus", ARRAY[]::TEXT[], 'Provera konfiguracije nije pokrenuta.', CURRENT_TIMESTAMP),
  ('GLS_PICKUP', 'NOT_CONFIGURED'::"IntegrationStatus", ARRAY[]::TEXT[], 'Provera konfiguracije nije pokrenuta.', CURRENT_TIMESTAMP),
  ('XEXPRESS_PICKUP', 'NOT_CONFIGURED'::"IntegrationStatus", ARRAY[]::TEXT[], 'Provera konfiguracije nije pokrenuta.', CURRENT_TIMESTAMP),
  ('NEWSLETTER', 'NOT_CONFIGURED'::"IntegrationStatus", ARRAY[]::TEXT[], 'Provera konfiguracije nije pokrenuta.', CURRENT_TIMESTAMP),
  ('VIBER', 'NOT_CONFIGURED'::"IntegrationStatus", ARRAY[]::TEXT[], 'Provera konfiguracije nije pokrenuta.', CURRENT_TIMESTAMP)
ON CONFLICT ("provider") DO NOTHING;

-- Domain-level integrity that cannot be represented directly in Prisma.
ALTER TABLE "PictogramPlacement"
  ADD CONSTRAINT "PictogramPlacement_exactly_one_target_check"
  CHECK (num_nonnulls("actionId", "landingPageId") = 1);

ALTER TABLE "MobileTab"
  ADD CONSTRAINT "MobileTab_single_destination_check"
  CHECK (num_nonnulls("actionId", "landingPageId", "href") = 1);

ALTER TABLE "MobileTab"
  ADD CONSTRAINT "MobileTab_position_check"
  CHECK ("position" BETWEEN 1 AND 4);

ALTER TABLE "DispatchNoteItem"
  ADD CONSTRAINT "DispatchNoteItem_qty_positive_check"
  CHECK ("qty" > 0);

ALTER TABLE "PartnerReservation"
  ADD CONSTRAINT "PartnerReservation_qty_positive_check"
  CHECK ("qty" > 0);
