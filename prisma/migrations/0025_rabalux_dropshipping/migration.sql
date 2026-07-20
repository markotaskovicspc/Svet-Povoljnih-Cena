CREATE TYPE "ProductAssetSyncStatus" AS ENUM ('READY', 'PENDING', 'FAILED');
CREATE TYPE "ProductAttachmentKind" AS ENUM ('MANUAL', 'ENERGY_LABEL');
CREATE TYPE "SupplierFulfillmentMode" AS ENUM ('NONE', 'EMAIL', 'HTTP');
CREATE TYPE "ImportKind" AS ENUM ('GENERIC', 'CATALOG', 'STOCK', 'MEDIA');
CREATE TYPE "SupplierFulfillmentStatus" AS ENUM (
  'PENDING',
  'SENT',
  'CONFIRMED',
  'PICKUP_READY',
  'CANCELLED',
  'COMPLETED',
  'FAILED'
);

DROP INDEX IF EXISTS "Product_barcode_key";

ALTER TABLE "Product"
  ADD COLUMN "technicalSpecs" JSONB,
  ADD COLUMN "warrantyYears" INTEGER,
  ADD COLUMN "countryOfOrigin" TEXT,
  ADD COLUMN "supplierReservedStock" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "supplierNextArrivalAt" TIMESTAMP(3);

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_supplierReservedStock_nonnegative"
  CHECK ("supplierReservedStock" >= 0);

ALTER TABLE "ProductMedia"
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "syncStatus" "ProductAssetSyncStatus" NOT NULL DEFAULT 'READY';

ALTER TABLE "Supplier"
  ADD COLUMN "integrationKey" TEXT,
  ADD COLUMN "catalogFallbackUrl" TEXT,
  ADD COLUMN "stockFeedUrl" TEXT,
  ADD COLUMN "stockAuthUser" TEXT,
  ADD COLUMN "stockAuthPass" TEXT,
  ADD COLUMN "fulfillmentMode" "SupplierFulfillmentMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "reservationUrl" TEXT;

ALTER TABLE "ImportRun"
  ADD COLUMN "kind" "ImportKind" NOT NULL DEFAULT 'GENERIC',
  ADD COLUMN "metadata" JSONB;

ALTER TABLE "OrderItem"
  ADD COLUMN "warehouseReservedQty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "supplierReservedQty" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "supplierExternalSku" TEXT;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_reservation_allocation_nonnegative"
  CHECK ("warehouseReservedQty" >= 0 AND "supplierReservedQty" >= 0),
  ADD CONSTRAINT "OrderItem_reservation_allocation_matches_qty"
  CHECK (
    ("warehouseReservedQty" = 0 AND "supplierReservedQty" = 0)
    OR "warehouseReservedQty" + "supplierReservedQty" = "qty"
  );

ALTER TABLE "Reclamation"
  ADD COLUMN "supplierNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "supplierNotificationError" TEXT;

CREATE TABLE "ProductAttachment" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "kind" "ProductAttachmentKind" NOT NULL,
  "label" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "syncStatus" "ProductAssetSyncStatus" NOT NULL DEFAULT 'READY',
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierFulfillment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "loadingLocationId" TEXT,
  "status" "SupplierFulfillmentStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "reservationReleasedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierFulfillmentItem" (
  "id" TEXT NOT NULL,
  "fulfillmentId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "productId" TEXT,
  "externalSku" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  CONSTRAINT "SupplierFulfillmentItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierFulfillmentItem_qty_positive" CHECK ("qty" > 0)
);

CREATE UNIQUE INDEX "Product_supplierId_supplierExternalId_key"
  ON "Product"("supplierId", "supplierExternalId");
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");
CREATE INDEX "ProductMedia_syncStatus_idx" ON "ProductMedia"("syncStatus");
CREATE UNIQUE INDEX "Supplier_integrationKey_key" ON "Supplier"("integrationKey");
CREATE UNIQUE INDEX "ProductAttachment_productId_kind_order_key"
  ON "ProductAttachment"("productId", "kind", "order");
CREATE INDEX "ProductAttachment_productId_order_idx"
  ON "ProductAttachment"("productId", "order");
CREATE INDEX "ProductAttachment_syncStatus_idx"
  ON "ProductAttachment"("syncStatus");
CREATE UNIQUE INDEX "SupplierFulfillment_orderId_supplierId_key"
  ON "SupplierFulfillment"("orderId", "supplierId");
CREATE INDEX "SupplierFulfillment_supplierId_status_createdAt_idx"
  ON "SupplierFulfillment"("supplierId", "status", "createdAt");
CREATE INDEX "SupplierFulfillment_loadingLocationId_idx"
  ON "SupplierFulfillment"("loadingLocationId");
CREATE UNIQUE INDEX "SupplierFulfillmentItem_orderItemId_key"
  ON "SupplierFulfillmentItem"("orderItemId");
CREATE INDEX "SupplierFulfillmentItem_fulfillmentId_idx"
  ON "SupplierFulfillmentItem"("fulfillmentId");
CREATE INDEX "SupplierFulfillmentItem_productId_idx"
  ON "SupplierFulfillmentItem"("productId");
CREATE INDEX "SupplierFulfillmentItem_externalSku_idx"
  ON "SupplierFulfillmentItem"("externalSku");

ALTER TABLE "ProductAttachment"
  ADD CONSTRAINT "ProductAttachment_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierFulfillment"
  ADD CONSTRAINT "SupplierFulfillment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierFulfillment"
  ADD CONSTRAINT "SupplierFulfillment_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierFulfillment"
  ADD CONSTRAINT "SupplierFulfillment_loadingLocationId_fkey"
  FOREIGN KEY ("loadingLocationId") REFERENCES "SupplierLoadingLocation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierFulfillmentItem"
  ADD CONSTRAINT "SupplierFulfillmentItem_fulfillmentId_fkey"
  FOREIGN KEY ("fulfillmentId") REFERENCES "SupplierFulfillment"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierFulfillmentItem"
  ADD CONSTRAINT "SupplierFulfillmentItem_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierFulfillmentItem"
  ADD CONSTRAINT "SupplierFulfillmentItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "Supplier" (
  "id",
  "name",
  "integrationKey",
  "code",
  "feedUrl",
  "catalogFallbackUrl",
  "authUser",
  "authPass",
  "stockFeedUrl",
  "stockAuthUser",
  "stockAuthPass",
  "fulfillmentMode",
  "enabled",
  "email",
  "country",
  "currency",
  "deliveryDays",
  "transitDays",
  "notes",
  "createdAt",
  "updatedAt"
) VALUES (
  'supplier-rabalux',
  'Rabalux',
  'RABALUX',
  'RABALUX',
  'https://rabalux.rs/downloadmanager/downloadha/nohtml/1/id/332',
  'https://rabalux.hu/downloadmanager/downloadha/nohtml/1/id/18',
  'env:RABALUX_CATALOG_USER',
  'env:RABALUX_CATALOG_PASS',
  'https://rabalux.hu/downloadmanager/downloadha/nohtml/1/id/11',
  'env:RABALUX_STOCK_USER',
  'env:RABALUX_STOCK_PASS',
  'EMAIL',
  TRUE,
  'infosrb@rabalux.com',
  'RS',
  'RSD',
  7,
  10,
  'Dropshipping dobavljač. Lokacija preuzimanja mora biti potvrđena pre kreiranja kurira.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE SET
  "integrationKey" = EXCLUDED."integrationKey",
  "code" = EXCLUDED."code",
  "feedUrl" = EXCLUDED."feedUrl",
  "catalogFallbackUrl" = EXCLUDED."catalogFallbackUrl",
  "authUser" = EXCLUDED."authUser",
  "authPass" = EXCLUDED."authPass",
  "stockFeedUrl" = EXCLUDED."stockFeedUrl",
  "stockAuthUser" = EXCLUDED."stockAuthUser",
  "stockAuthPass" = EXCLUDED."stockAuthPass",
  "fulfillmentMode" = EXCLUDED."fulfillmentMode",
  "email" = EXCLUDED."email",
  "deliveryDays" = EXCLUDED."deliveryDays",
  "transitDays" = EXCLUDED."transitDays",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "SupplierLoadingLocation" (
  "id", "supplierId", "name", "position", "country", "createdAt", "updatedAt"
)
SELECT
  'supplier-rabalux-location-domestic',
  "id",
  'Domaći magacin',
  1,
  'RS',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Supplier" WHERE "integrationKey" = 'RABALUX'
ON CONFLICT ("supplierId", "position") DO NOTHING;

INSERT INTO "SupplierLoadingLocation" (
  "id", "supplierId", "name", "position", "country", "createdAt", "updatedAt"
)
SELECT
  'supplier-rabalux-location-import',
  "id",
  'Uvozni magacin',
  2,
  'RS',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Supplier" WHERE "integrationKey" = 'RABALUX'
ON CONFLICT ("supplierId", "position") DO NOTHING;
