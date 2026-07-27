-- Complete the dispatch-note workflow after the customer-base migrations with company snapshots, print totals,
-- order-import provenance, SEF submission state and inventory traceability.

ALTER TABLE "OrderItem"
ADD COLUMN "warehouseDispatchedQty" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Customer"
ADD COLUMN "registrationNumber" TEXT;

ALTER TABLE "DispatchNote"
ADD COLUMN "issueDate" TIMESTAMP(3),
ADD COLUMN "issuerCustomerId" TEXT,
ADD COLUMN "receiverCustomerId" TEXT,
ADD COLUMN "carrierCustomerId" TEXT,
ADD COLUMN "issuerName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "issuerPib" TEXT NOT NULL DEFAULT '',
ADD COLUMN "issuerRegistrationNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN "issuerAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN "issuerCity" TEXT NOT NULL DEFAULT '',
ADD COLUMN "issuerPostalCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN "issuerCountry" TEXT NOT NULL DEFAULT 'RS',
ADD COLUMN "issuerPhone" TEXT,
ADD COLUMN "issuerEmail" TEXT,
ADD COLUMN "receiverName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "receiverPib" TEXT NOT NULL DEFAULT '',
ADD COLUMN "receiverRegistrationNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN "receiverAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN "receiverCity" TEXT NOT NULL DEFAULT '',
ADD COLUMN "receiverPostalCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN "receiverCountry" TEXT NOT NULL DEFAULT 'RS',
ADD COLUMN "receiverPhone" TEXT,
ADD COLUMN "receiverEmail" TEXT,
ADD COLUMN "carrierName" TEXT,
ADD COLUMN "carrierPib" TEXT,
ADD COLUMN "carrierRegistrationNumber" TEXT,
ADD COLUMN "carrierAddress" TEXT,
ADD COLUMN "carrierCity" TEXT,
ADD COLUMN "carrierPostalCode" TEXT,
ADD COLUMN "carrierCountry" TEXT,
ADD COLUMN "carrierPhone" TEXT,
ADD COLUMN "carrierEmail" TEXT,
ADD COLUMN "licensePlate" TEXT,
ADD COLUMN "courierFirstName" TEXT,
ADD COLUMN "courierLastName" TEXT,
ADD COLUMN "courierIdNumber" TEXT,
ADD COLUMN "showPrices" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'RSD',
ADD COLUMN "totalNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "totalVat" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "totalGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "importFrom" TIMESTAMP(3),
ADD COLUMN "importTo" TIMESTAMP(3),
ADD COLUMN "shipmentMethod" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "actualDispatchAt" TIMESTAMP(3),
ADD COLUMN "plannedDeliveryAt" TIMESTAMP(3),
ADD COLUMN "sefRequestId" TEXT,
ADD COLUMN "sefDocumentId" TEXT,
ADD COLUMN "sefStatus" TEXT,
ADD COLUMN "sefSentAt" TIMESTAMP(3),
ADD COLUMN "sefResponse" JSONB,
ADD COLUMN "sefError" TEXT;

UPDATE "DispatchNote"
SET "issueDate" = "createdAt"
WHERE "issueDate" IS NULL;

ALTER TABLE "DispatchNote"
ALTER COLUMN "issueDate" SET NOT NULL,
ALTER COLUMN "issueDate" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "DispatchNoteItem"
ADD COLUMN "sourceOrderNumber" TEXT,
ADD COLUMN "subgroup" TEXT,
ADD COLUMN "collection" TEXT,
ADD COLUMN "shortDescription" TEXT,
ADD COLUMN "shortName" TEXT,
ADD COLUMN "attribute1" TEXT,
ADD COLUMN "attribute2" TEXT,
ADD COLUMN "attribute3" TEXT,
ADD COLUMN "attribute4" TEXT,
ADD COLUMN "color1" TEXT,
ADD COLUMN "color2" TEXT,
ADD COLUMN "unitPriceGross" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 20,
ADD COLUMN "totalNet" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "totalVat" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "totalGross" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Preserve useful snapshots for any legacy dispatch rows that were already
-- linked to a sales-order item before this workflow was introduced.
UPDATE "DispatchNoteItem" AS dispatch_item
SET
  "sourceOrderNumber" = sales_order."number",
  "subgroup" = order_item."subgroupName",
  "collection" = order_item."collectionName",
  "shortDescription" = order_item."shortDescriptionSnapshot",
  "shortName" = COALESCE(order_item."shortNameSnapshot", order_item."name"),
  "attribute1" = order_item."attribute1",
  "attribute2" = order_item."attribute2",
  "attribute3" = order_item."attribute3",
  "attribute4" = order_item."attribute4",
  "color1" = order_item."color1",
  "color2" = order_item."color2",
  "unitPriceGross" = order_item."unitPriceSale",
  "totalGross" = ROUND(order_item."unitPriceSale" * dispatch_item."qty", 2),
  "totalNet" = ROUND(order_item."unitPriceSale" * dispatch_item."qty" / 1.2, 2),
  "totalVat" = ROUND(
    order_item."unitPriceSale" * dispatch_item."qty" -
    order_item."unitPriceSale" * dispatch_item."qty" / 1.2,
    2
  )
FROM "OrderItem" AS order_item
JOIN "Order" AS sales_order ON sales_order."id" = order_item."orderId"
WHERE dispatch_item."orderItemId" = order_item."id";

UPDATE "DispatchNote" AS dispatch
SET
  "totalNet" = totals."net",
  "totalVat" = totals."vat",
  "totalGross" = totals."gross"
FROM (
  SELECT
    "dispatchNoteId",
    COALESCE(SUM("totalNet"), 0) AS "net",
    COALESCE(SUM("totalVat"), 0) AS "vat",
    COALESCE(SUM("totalGross"), 0) AS "gross"
  FROM "DispatchNoteItem"
  GROUP BY "dispatchNoteId"
) AS totals
WHERE dispatch."id" = totals."dispatchNoteId"
  AND dispatch."type" <> 'INTERNAL';

-- A posted legacy dispatch must never be restored as an active order
-- reservation later. Reconcile only the tracking counters; historical stock
-- movements remain immutable.
WITH shipped AS (
  SELECT
    item."orderItemId",
    SUM(item."qty")::INTEGER AS "qty"
  FROM "DispatchNoteItem" AS item
  JOIN "DispatchNote" AS dispatch ON dispatch."id" = item."dispatchNoteId"
  WHERE item."orderItemId" IS NOT NULL
    AND dispatch."status" = 'POSTED'
    AND dispatch."type" = 'CUSTOMER'
  GROUP BY item."orderItemId"
)
UPDATE "OrderItem" AS order_item
SET
  "warehouseDispatchedQty" = LEAST(order_item."qty", shipped."qty"),
  "warehouseReservedQty" = GREATEST(
    order_item."warehouseReservedQty" - shipped."qty",
    0
  )
FROM shipped
WHERE order_item."id" = shipped."orderItemId";

ALTER TABLE "StockMovement"
ADD COLUMN "dispatchNoteId" TEXT;

CREATE UNIQUE INDEX "DispatchNote_sefRequestId_key"
ON "DispatchNote"("sefRequestId");

CREATE INDEX "DispatchNote_issuerCustomerId_issueDate_idx"
ON "DispatchNote"("issuerCustomerId", "issueDate");

CREATE INDEX "DispatchNote_receiverCustomerId_issueDate_idx"
ON "DispatchNote"("receiverCustomerId", "issueDate");

CREATE INDEX "DispatchNote_carrierCustomerId_idx"
ON "DispatchNote"("carrierCustomerId");

CREATE INDEX "Customer_registrationNumber_idx"
ON "Customer"("registrationNumber");

CREATE INDEX "DispatchNote_sefSentAt_idx"
ON "DispatchNote"("sefSentAt");

CREATE INDEX "StockMovement_dispatchNoteId_idx"
ON "StockMovement"("dispatchNoteId");

ALTER TABLE "DispatchNote"
ADD CONSTRAINT "DispatchNote_issuerCustomerId_fkey"
FOREIGN KEY ("issuerCustomerId") REFERENCES "Customer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DispatchNote"
ADD CONSTRAINT "DispatchNote_receiverCustomerId_fkey"
FOREIGN KEY ("receiverCustomerId") REFERENCES "Customer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DispatchNote"
ADD CONSTRAINT "DispatchNote_carrierCustomerId_fkey"
FOREIGN KEY ("carrierCustomerId") REFERENCES "Customer"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_dispatchNoteId_fkey"
FOREIGN KEY ("dispatchNoteId") REFERENCES "DispatchNote"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
