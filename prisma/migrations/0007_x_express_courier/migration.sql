-- X Express courier integration: dictionaries, sync runs, tracking range,
-- and provider metadata on shipments/events.

CREATE TYPE "CourierSyncKind" AS ENUM (
    'LOCATIONS',
    'STATUSES',
    'SHIPMENTS'
);

CREATE TYPE "CourierSyncStatus" AS ENUM (
    'RUNNING',
    'SUCCESS',
    'PARTIAL',
    'FAILED'
);

ALTER TABLE "Shipment"
ADD COLUMN "provider" TEXT,
ADD COLUMN "providerOrderId" TEXT,
ADD COLUMN "providerShipmentId" TEXT,
ADD COLUMN "providerStatusCode" TEXT,
ADD COLUMN "lastStatusSyncAt" TIMESTAMP(3),
ADD COLUMN "rawCreateResponse" JSONB,
ADD COLUMN "syncError" TEXT;

ALTER TABLE "ShipmentEvent"
ADD COLUMN "providerStatusCode" TEXT,
ADD COLUMN "providerEventId" TEXT,
ADD COLUMN "raw" JSONB;

CREATE TABLE "CourierLocationCode" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'X_EXPRESS',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postalCode" TEXT,
    "municipality" TEXT,
    "city" TEXT,
    "settlement" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierLocationCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourierStatusCode" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'X_EXPRESS',
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "shipmentStatus" "ShipmentStatus",
    "orderStatus" "OrderStatus",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierStatusCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourierSyncRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'X_EXPRESS',
    "kind" "CourierSyncKind" NOT NULL,
    "status" "CourierSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "recordsRead" INTEGER NOT NULL DEFAULT 0,
    "recordsOk" INTEGER NOT NULL DEFAULT 0,
    "recordsFail" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "raw" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CourierSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CourierCodeSequence" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'X_EXPRESS',
    "prefix" TEXT NOT NULL,
    "rangeStart" INTEGER NOT NULL,
    "rangeEnd" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL,
    "warningAt" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourierCodeSequence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Shipment_provider_status_lastStatusSyncAt_idx" ON "Shipment"("provider", "status", "lastStatusSyncAt");
CREATE INDEX "Shipment_providerOrderId_idx" ON "Shipment"("providerOrderId");
CREATE INDEX "Shipment_providerShipmentId_idx" ON "Shipment"("providerShipmentId");

CREATE UNIQUE INDEX "ShipmentEvent_providerEventId_key" ON "ShipmentEvent"("providerEventId");

CREATE UNIQUE INDEX "CourierLocationCode_provider_code_key" ON "CourierLocationCode"("provider", "code");
CREATE INDEX "CourierLocationCode_provider_active_name_idx" ON "CourierLocationCode"("provider", "active", "name");
CREATE INDEX "CourierLocationCode_postalCode_idx" ON "CourierLocationCode"("postalCode");

CREATE UNIQUE INDEX "CourierStatusCode_provider_code_key" ON "CourierStatusCode"("provider", "code");
CREATE INDEX "CourierStatusCode_provider_active_idx" ON "CourierStatusCode"("provider", "active");
CREATE INDEX "CourierStatusCode_shipmentStatus_idx" ON "CourierStatusCode"("shipmentStatus");

CREATE INDEX "CourierSyncRun_provider_kind_startedAt_idx" ON "CourierSyncRun"("provider", "kind", "startedAt");
CREATE INDEX "CourierSyncRun_status_startedAt_idx" ON "CourierSyncRun"("status", "startedAt");

CREATE UNIQUE INDEX "CourierCodeSequence_provider_prefix_key" ON "CourierCodeSequence"("provider", "prefix");
