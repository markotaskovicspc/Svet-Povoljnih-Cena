-- X Express full integration: address dictionaries, strict checkout town IDs,
-- local labels, and webhook staging.

ALTER TABLE "Address"
  ADD COLUMN "xExpressTownId" INTEGER,
  ADD COLUMN "xExpressStreetId" INTEGER;

ALTER TABLE "Order"
  ADD COLUMN "shipXExpressTownId" INTEGER,
  ADD COLUMN "shipXExpressStreetId" INTEGER,
  ADD COLUMN "billXExpressTownId" INTEGER,
  ADD COLUMN "billXExpressStreetId" INTEGER;

ALTER TABLE "Shipment"
  ADD COLUMN "packageCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "providerRouteCode" TEXT,
  ADD COLUMN "providerRouteName" TEXT;

CREATE TABLE "XExpressMunicipality" (
  "id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "postalCode" TEXT,
  "priority" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "raw" JSONB,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "XExpressMunicipality_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XExpressTown" (
  "id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "displayName" TEXT,
  "municipalityId" INTEGER,
  "postalCode" TEXT,
  "priority" INTEGER,
  "cutOffPickupTime" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "raw" JSONB,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "XExpressTown_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XExpressStreet" (
  "id" INTEGER NOT NULL,
  "streetId" INTEGER,
  "name" TEXT NOT NULL,
  "simpleName" TEXT,
  "townId" INTEGER NOT NULL,
  "official" BOOLEAN NOT NULL DEFAULT false,
  "deleted" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "raw" JSONB,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "XExpressStreet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "XExpressWebhookEvent" (
  "id" TEXT NOT NULL,
  "notifyId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "orderCode" TEXT,
  "referenceId" TEXT NOT NULL,
  "referenceGuid" TEXT,
  "statusCode" TEXT NOT NULL,
  "statusTime" TIMESTAMP(3) NOT NULL,
  "raw" JSONB NOT NULL,
  "orderId" TEXT,
  "shipmentId" TEXT,
  "processedAt" TIMESTAMP(3),
  "processError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "XExpressWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "XExpressMunicipality_active_name_idx" ON "XExpressMunicipality"("active", "name");
CREATE INDEX "XExpressTown_active_name_idx" ON "XExpressTown"("active", "name");
CREATE INDEX "XExpressTown_postalCode_idx" ON "XExpressTown"("postalCode");
CREATE INDEX "XExpressTown_municipalityId_idx" ON "XExpressTown"("municipalityId");
CREATE INDEX "XExpressStreet_townId_active_simpleName_idx" ON "XExpressStreet"("townId", "active", "simpleName");
CREATE INDEX "XExpressStreet_streetId_idx" ON "XExpressStreet"("streetId");
CREATE UNIQUE INDEX "XExpressWebhookEvent_notifyId_key" ON "XExpressWebhookEvent"("notifyId");
CREATE INDEX "XExpressWebhookEvent_referenceId_idx" ON "XExpressWebhookEvent"("referenceId");
CREATE INDEX "XExpressWebhookEvent_statusCode_idx" ON "XExpressWebhookEvent"("statusCode");
CREATE INDEX "XExpressWebhookEvent_processedAt_idx" ON "XExpressWebhookEvent"("processedAt");

ALTER TABLE "XExpressTown"
  ADD CONSTRAINT "XExpressTown_municipalityId_fkey"
  FOREIGN KEY ("municipalityId") REFERENCES "XExpressMunicipality"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "XExpressStreet"
  ADD CONSTRAINT "XExpressStreet_townId_fkey"
  FOREIGN KEY ("townId") REFERENCES "XExpressTown"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
