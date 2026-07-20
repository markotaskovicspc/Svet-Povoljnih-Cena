ALTER TABLE "Order"
  ADD COLUMN "glsDeliveryPointId" TEXT,
  ADD COLUMN "glsDeliveryPointName" TEXT,
  ADD COLUMN "glsDeliveryPointAddress" TEXT,
  ADD COLUMN "glsDeliveryPointCity" TEXT,
  ADD COLUMN "glsDeliveryPointPostalCode" TEXT;

ALTER TABLE "Shipment"
  ADD COLUMN "providerParcelId" TEXT,
  ADD COLUMN "providerParcelIds" JSONB,
  ADD COLUMN "providerParcelNumbers" JSONB,
  ADD COLUMN "labelObjectKey" TEXT,
  ADD COLUMN "labelMimeType" TEXT;

ALTER TABLE "OrderSequence" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "CourierDeliveryPoint" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MYGLS',
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT,
  "street" TEXT,
  "city" TEXT,
  "postalCode" TEXT,
  "country" TEXT NOT NULL DEFAULT 'RS',
  "contactName" TEXT,
  "contactPhone" TEXT,
  "contactEmail" TEXT,
  "latitude" DECIMAL(10,6),
  "longitude" DECIMAL(10,6),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "raw" JSONB,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourierDeliveryPoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourierDeliveryPoint_provider_code_key"
  ON "CourierDeliveryPoint"("provider", "code");
CREATE INDEX "CourierDeliveryPoint_provider_active_city_idx"
  ON "CourierDeliveryPoint"("provider", "active", "city");
CREATE INDEX "CourierDeliveryPoint_postalCode_idx"
  ON "CourierDeliveryPoint"("postalCode");

CREATE TABLE "CourierMasterDataCursor" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'MYGLS',
  "kind" TEXT NOT NULL,
  "cursor" TEXT,
  "etag" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "raw" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CourierMasterDataCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CourierMasterDataCursor_provider_kind_key"
  ON "CourierMasterDataCursor"("provider", "kind");
CREATE INDEX "CourierMasterDataCursor_provider_updatedAt_idx"
  ON "CourierMasterDataCursor"("provider", "updatedAt");
