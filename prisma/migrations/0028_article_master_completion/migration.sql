-- Complete the article master card with independently editable name material,
-- denormalized DC availability and deterministic article numbering.
ALTER TABLE "Product"
  ADD COLUMN "shortName" TEXT,
  ADD COLUMN "materialText" TEXT,
  ADD COLUMN "dcAvailableQty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "availableWebAuto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "availableWholesaleAuto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "availableExportAuto" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Product"
SET "shortName" = "name"
WHERE "shortName" IS NULL;

CREATE TABLE "ArticleSequence" (
  "year" INTEGER NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ArticleSequence_pkey" PRIMARY KEY ("year")
);

INSERT INTO "ArticleSequence" ("year", "lastValue")
SELECT
  (match)[1]::INTEGER,
  MAX((match)[2]::INTEGER)
FROM (
  SELECT regexp_match("sku", '^NOV-([0-9]{4})-([0-9]+)$') AS match
  FROM "Product"
) parsed
WHERE match IS NOT NULL
GROUP BY (match)[1]::INTEGER
ON CONFLICT ("year") DO NOTHING;

ALTER TABLE "PartnerReservation"
  ADD COLUMN "warehouseId" TEXT;

UPDATE "PartnerReservation" reservation
SET "warehouseId" = warehouse."id"
FROM (
  SELECT "id"
  FROM "Warehouse"
  WHERE "active" = true
  ORDER BY "isDefault" DESC, "createdAt" ASC
  LIMIT 1
) warehouse
WHERE reservation."warehouseId" IS NULL;

ALTER TABLE "PartnerReservation"
  ADD CONSTRAINT "PartnerReservation_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PartnerReservation_warehouseId_status_idx"
  ON "PartnerReservation"("warehouseId", "status");

-- Product.stock remains the aggregate sellable balance. For installations
-- without warehouse rows, use that aggregate as the initial DC balance.
WITH default_warehouse AS (
  SELECT "id"
  FROM "Warehouse"
  WHERE "active" = true
  ORDER BY "isDefault" DESC, "createdAt" ASC
  LIMIT 1
),
dc_stock AS (
  SELECT stock."productId", stock."qty"
  FROM "WarehouseStock" stock
  JOIN default_warehouse warehouse ON warehouse."id" = stock."warehouseId"
),
products_with_warehouse_stock AS (
  SELECT DISTINCT "productId"
  FROM "WarehouseStock"
),
active_partner_reservations AS (
  SELECT reservation."productId", SUM(reservation."qty")::INTEGER AS qty
  FROM "PartnerReservation" reservation
  JOIN default_warehouse warehouse
    ON reservation."warehouseId" = warehouse."id"
       OR reservation."warehouseId" IS NULL
  WHERE reservation."status" = 'ACTIVE'
    AND (reservation."expiresAt" IS NULL OR reservation."expiresAt" > CURRENT_TIMESTAMP)
  GROUP BY reservation."productId"
),
availability AS (
  SELECT
    product."id",
    GREATEST(
      COALESCE(
        dc_stock."qty",
        CASE
          WHEN products_with_warehouse_stock."productId" IS NOT NULL THEN 0
          ELSE product."stock"
        END
      )
      - COALESCE(active_partner_reservations.qty, 0),
      0
    ) AS available
  FROM "Product" product
  LEFT JOIN dc_stock ON dc_stock."productId" = product."id"
  LEFT JOIN products_with_warehouse_stock
    ON products_with_warehouse_stock."productId" = product."id"
  LEFT JOIN active_partner_reservations
    ON active_partner_reservations."productId" = product."id"
)
UPDATE "Product" product
SET
  "dcAvailableQty" = availability.available,
  "availableWebAuto" = availability.available > 0,
  "availableWholesaleAuto" = availability.available > 10,
  "availableExportAuto" = availability.available > 20
FROM availability
WHERE availability."id" = product."id";
