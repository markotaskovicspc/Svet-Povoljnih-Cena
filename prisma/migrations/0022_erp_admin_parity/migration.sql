-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('SP', 'IT', 'DTZ', 'DOB', 'ARH', 'UZ');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WEB', 'ANANAS', 'VP', 'INO');

-- CreateEnum
CREATE TYPE "ProductLookupKind" AS ENUM ('ATTRIBUTE', 'COLOR', 'BENEFIT', 'CERTIFICATE');

-- CreateEnum
CREATE TYPE "AllocationBasis" AS ENUM ('AUTO_UTILIZATION', 'VALUE', 'WEIGHT', 'VOLUME', 'MANUAL');

-- CreateEnum
CREATE TYPE "PriceListKind" AS ENUM ('RETAIL', 'PURCHASE', 'WHOLESALE', 'EXPORT');

-- CreateEnum
CREATE TYPE "DiscountTarget" AS ENUM ('ALL', 'CATEGORY', 'GROUP');

-- CreateEnum
CREATE TYPE "CustomerGender" AS ENUM ('NEPOZNATO', 'ZENSKI', 'MUSKI');

-- CreateEnum
CREATE TYPE "DispatchNoteType" AS ENUM ('CUSTOMER', 'INTERNAL', 'STOCKTAKE');

-- CreateEnum
CREATE TYPE "DocumentPostingStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PickupBatchStatus" AS ENUM ('DRAFT', 'BOOKED', 'PICKED_UP', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PartnerReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PictogramSlot" AS ENUM ('TOP_LEFT_1', 'TOP_LEFT_2', 'BOTTOM_RIGHT_1', 'BOTTOM_RIGHT_2');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('PAGE_VIEW', 'PRODUCT_VIEW', 'ADD_TO_CART', 'CHECKOUT_STARTED', 'CHECKOUT_COMPLETED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('NOT_CONFIGURED', 'UNHEALTHY', 'HEALTHY');

-- CreateEnum
CREATE TYPE "ReclamationType" AS ENUM ('FIZICKO_OSTECENJE', 'KVAR');

-- CreateEnum
CREATE TYPE "ReclamationRequest" AS ENUM ('POPRAVKA', 'ZAMENA', 'POVRACAJ_NOVCA', 'UMANJENJE_CENE');

-- CreateEnum
CREATE TYPE "ReclamationDecision" AS ENUM ('CEKA', 'PRIHVACENA', 'ODBIJENA');

-- CreateEnum
CREATE TYPE "ReclamationResolution" AS ENUM ('POVRAT_NOVCA', 'ZAMENA_ARTIKLA', 'ZAMENA_DELA', 'POPUST');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementKind" ADD VALUE 'OPENING_BALANCE';
ALTER TYPE "StockMovementKind" ADD VALUE 'PURCHASE_RECEIPT';
ALTER TYPE "StockMovementKind" ADD VALUE 'DISPATCH';
ALTER TYPE "StockMovementKind" ADD VALUE 'INTERNAL_TRANSFER_OUT';
ALTER TYPE "StockMovementKind" ADD VALUE 'INTERNAL_TRANSFER_IN';
ALTER TYPE "StockMovementKind" ADD VALUE 'STOCK_COUNT';
ALTER TYPE "StockMovementKind" ADD VALUE 'PARTNER_RESERVATION';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "ananasBrokeragePct" DECIMAL(8,2),
ADD COLUMN     "ananasDeliveryPct" DECIMAL(8,2),
ADD COLUMN     "ananasStoragePct" DECIMAL(8,2),
ADD COLUMN     "articleStatus" "ArticleStatus" NOT NULL DEFAULT 'SP',
ADD COLUMN     "grossWeightKg" DECIMAL(10,3),
ADD COLUMN     "hsCode" TEXT,
ADD COLUMN     "moq" INTEGER,
ADD COLUMN     "packDepthCm" DECIMAL(8,2),
ADD COLUMN     "packGrossWeightKg" DECIMAL(10,3),
ADD COLUMN     "packHeightCm" DECIMAL(8,2),
ADD COLUMN     "packQty" INTEGER,
ADD COLUMN     "packWidthCm" DECIMAL(8,2),
ADD COLUMN     "supplierProductName" TEXT,
ADD COLUMN     "tncFrom" TIMESTAMP(3),
ADD COLUMN     "tncUntil" TIMESTAMP(3),
ADD COLUMN     "weightKg" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "defaultPriceListId" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "channel" "SalesChannel" NOT NULL DEFAULT 'WEB',
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "externalOrderNo" TEXT,
ADD COLUMN     "priceListId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "warehouseId" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "balanceAfterTotal" INTEGER,
ADD COLUMN     "balanceAfterWarehouse" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "allocationBasis" "AllocationBasis" NOT NULL DEFAULT 'AUTO_UTILIZATION',
ADD COLUMN     "exchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "freightCurrency" "ErpCurrency" NOT NULL DEFAULT 'RSD',
ADD COLUMN     "freightExchangeRate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "loadingLocationId" TEXT,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "receivingWarehouseId" TEXT,
ADD COLUMN     "transportTypeId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "additionalCostAllocated" DECIMAL(12,2),
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "certificates" TEXT,
ADD COLUMN     "priceValidFrom" TIMESTAMP(3),
ADD COLUMN     "supplierProductName" TEXT;

-- AlterTable
ALTER TABLE "InboundInvoice" ADD COLUMN     "allocationBasis" "AllocationBasis" NOT NULL DEFAULT 'AUTO_UTILIZATION',
ADD COLUMN     "grossValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "netValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "purchaseOrderId" TEXT,
ADD COLUMN     "vatValue" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Reclamation" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "courierRequestedAt" TIMESTAMP(3),
ADD COLUMN     "decision" "ReclamationDecision" NOT NULL DEFAULT 'CEKA',
ADD COLUMN     "orderItemId" TEXT,
ADD COLUMN     "purchaseDate" TIMESTAMP(3),
ADD COLUMN     "request" "ReclamationRequest",
ADD COLUMN     "resolution" "ReclamationResolution",
ADD COLUMN     "resolutionNote" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3),
ADD COLUMN     "type" "ReclamationType",
ADD COLUMN     "warehouseRequestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductLookupValue" (
    "id" TEXT NOT NULL,
    "kind" "ProductLookupKind" NOT NULL,
    "value" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductLookupValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductLookupAssignment" (
    "productId" TEXT NOT NULL,
    "lookupValueId" TEXT NOT NULL,

    CONSTRAINT "ProductLookupAssignment_pkey" PRIMARY KEY ("productId","lookupValueId")
);

-- CreateTable
CREATE TABLE "SupplierLoadingLocation" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'RS',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierLoadingLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payloadKg" DECIMAL(12,3),
    "payloadM3" DECIMAL(12,3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRateSnapshot" (
    "id" TEXT NOT NULL,
    "baseCurrency" "ErpCurrency" NOT NULL DEFAULT 'RSD',
    "quoteCurrency" "ErpCurrency" NOT NULL,
    "rate" DECIMAL(14,6) NOT NULL,
    "validAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PriceListKind" NOT NULL,
    "currency" "ErpCurrency" NOT NULL DEFAULT 'RSD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListEntry" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionProduct" (
    "actionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionProduct_pkey" PRIMARY KEY ("actionId","productId")
);

-- CreateTable
CREATE TABLE "LoyaltyRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountPct" DECIMAL(8,2) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyPriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oldPrice" DECIMAL(12,2),
    "newPrice" DECIMAL(12,2),
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinearPromotion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountPct" DECIMAL(8,2) NOT NULL,
    "target" "DiscountTarget" NOT NULL DEFAULT 'ALL',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinearPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinearPromotionCategory" (
    "promotionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "LinearPromotionCategory_pkey" PRIMARY KEY ("promotionId","categoryId")
);

-- CreateTable
CREATE TABLE "LinearPromotionGroup" (
    "promotionId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    CONSTRAINT "LinearPromotionGroup_pkey" PRIMARY KEY ("promotionId","groupId")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "pib" TEXT,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'RS',
    "phone" TEXT,
    "email" TEXT,
    "gender" "CustomerGender" NOT NULL DEFAULT 'NEPOZNATO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "DispatchNoteType" NOT NULL DEFAULT 'CUSTOMER',
    "status" "DocumentPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "orderId" TEXT,
    "sourceWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT,
    "destinationName" TEXT,
    "destinationAddress" TEXT,
    "destinationCity" TEXT,
    "notes" TEXT,
    "postedAt" TIMESTAMP(3),
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchNoteItem" (
    "id" TEXT NOT NULL,
    "dispatchNoteId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "productId" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "DispatchNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupBatch" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "courier" "ShipmentService",
    "status" "PickupBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "manifestRef" TEXT,
    "pickupDate" TIMESTAMP(3),
    "configurationIssue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickupBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupBatchLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "packageNo" INTEGER NOT NULL DEFAULT 1,
    "weightKg" DECIMAL(10,3),
    "widthCm" DECIMAL(8,2),
    "depthCm" DECIMAL(8,2),
    "heightCm" DECIMAL(8,2),

    CONSTRAINT "PickupBatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerApiClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "rateLimit" INTEGER NOT NULL DEFAULT 120,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerReservation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "status" "PartnerReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "DocumentPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "countedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "notes" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountItem" (
    "id" TEXT NOT NULL,
    "stockCountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expectedQty" INTEGER NOT NULL,
    "countedQty" INTEGER NOT NULL,
    "differenceQty" INTEGER NOT NULL,

    CONSTRAINT "StockCountItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lead" TEXT,
    "heroImageUrl" TEXT,
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "status" "LandingPageStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPageSection" (
    "id" TEXT NOT NULL,
    "landingPageId" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "imageUrl" TEXT,
    "productSkus" TEXT[],
    "position" INTEGER NOT NULL,

    CONSTRAINT "LandingPageSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PictogramPlacement" (
    "id" TEXT NOT NULL,
    "pictogramId" TEXT NOT NULL,
    "actionId" TEXT,
    "landingPageId" TEXT,
    "slot" "PictogramSlot" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PictogramPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobileTab" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT,
    "position" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "actionId" TEXT,
    "landingPageId" TEXT,
    "href" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MobileTab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "type" "AnalyticsEventType" NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "sessionId" TEXT,
    "path" TEXT,
    "productId" TEXT,
    "orderId" TEXT,
    "quantity" INTEGER,
    "value" DECIMAL(12,2),
    "consentVersion" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationHealth" (
    "provider" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "missingKeys" TEXT[],
    "message" TEXT,
    "checkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationHealth_pkey" PRIMARY KEY ("provider")
);

-- CreateTable
CREATE TABLE "AdminSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NewsletterCampaign" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "recipients" INTEGER,
    "delivered" INTEGER,
    "failed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSavedView" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "sorting" JSONB NOT NULL,
    "columns" JSONB NOT NULL,
    "pageSize" INTEGER NOT NULL DEFAULT 100,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminSavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductLookupValue_kind_active_value_idx" ON "ProductLookupValue"("kind", "active", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ProductLookupValue_kind_value_key" ON "ProductLookupValue"("kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "ProductLookupValue_kind_slug_key" ON "ProductLookupValue"("kind", "slug");

-- CreateIndex
CREATE INDEX "ProductLookupAssignment_lookupValueId_idx" ON "ProductLookupAssignment"("lookupValueId");

-- CreateIndex
CREATE INDEX "SupplierLoadingLocation_supplierId_name_idx" ON "SupplierLoadingLocation"("supplierId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierLoadingLocation_supplierId_position_key" ON "SupplierLoadingLocation"("supplierId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TransportType_code_key" ON "TransportType"("code");

-- CreateIndex
CREATE INDEX "ExchangeRateSnapshot_quoteCurrency_validAt_idx" ON "ExchangeRateSnapshot"("quoteCurrency", "validAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRateSnapshot_baseCurrency_quoteCurrency_validAt_sou_key" ON "ExchangeRateSnapshot"("baseCurrency", "quoteCurrency", "validAt", "source");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_code_key" ON "PriceList"("code");

-- CreateIndex
CREATE INDEX "PriceList_kind_active_validFrom_idx" ON "PriceList"("kind", "active", "validFrom");

-- CreateIndex
CREATE INDEX "PriceListEntry_productId_validFrom_validTo_idx" ON "PriceListEntry"("productId", "validFrom", "validTo");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListEntry_priceListId_productId_validFrom_key" ON "PriceListEntry"("priceListId", "productId", "validFrom");

-- CreateIndex
CREATE INDEX "ActionProduct_productId_idx" ON "ActionProduct"("productId");

-- CreateIndex
CREATE INDEX "LoyaltyRule_active_priority_startsAt_endsAt_idx" ON "LoyaltyRule"("active", "priority", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "LoyaltyPriceHistory_productId_createdAt_idx" ON "LoyaltyPriceHistory"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "LinearPromotion_active_priority_startsAt_endsAt_idx" ON "LinearPromotion"("active", "priority", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "LinearPromotionCategory_categoryId_idx" ON "LinearPromotionCategory"("categoryId");

-- CreateIndex
CREATE INDEX "LinearPromotionGroup_groupId_idx" ON "LinearPromotionGroup"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_userId_key" ON "Customer"("userId");

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_pib_idx" ON "Customer"("pib");

-- CreateIndex
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchNote_number_key" ON "DispatchNote"("number");

-- CreateIndex
CREATE INDEX "DispatchNote_orderId_idx" ON "DispatchNote"("orderId");

-- CreateIndex
CREATE INDEX "DispatchNote_status_createdAt_idx" ON "DispatchNote"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DispatchNote_sourceWarehouseId_createdAt_idx" ON "DispatchNote"("sourceWarehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "DispatchNoteItem_dispatchNoteId_idx" ON "DispatchNoteItem"("dispatchNoteId");

-- CreateIndex
CREATE INDEX "DispatchNoteItem_orderItemId_idx" ON "DispatchNoteItem"("orderItemId");

-- CreateIndex
CREATE INDEX "DispatchNoteItem_productId_idx" ON "DispatchNoteItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupBatch_number_key" ON "PickupBatch"("number");

-- CreateIndex
CREATE INDEX "PickupBatch_status_pickupDate_idx" ON "PickupBatch"("status", "pickupDate");

-- CreateIndex
CREATE INDEX "PickupBatchLine_orderId_idx" ON "PickupBatchLine"("orderId");

-- CreateIndex
CREATE INDEX "PickupBatchLine_orderItemId_idx" ON "PickupBatchLine"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupBatchLine_batchId_orderId_packageNo_key" ON "PickupBatchLine"("batchId", "orderId", "packageNo");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerApiClient_keyPrefix_key" ON "PartnerApiClient"("keyPrefix");

-- CreateIndex
CREATE INDEX "PartnerReservation_productId_status_idx" ON "PartnerReservation"("productId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerReservation_clientId_idempotencyKey_key" ON "PartnerReservation"("clientId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerReservation_clientId_externalRef_key" ON "PartnerReservation"("clientId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_number_key" ON "StockCount"("number");

-- CreateIndex
CREATE INDEX "StockCount_warehouseId_status_createdAt_idx" ON "StockCount"("warehouseId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StockCountItem_productId_idx" ON "StockCountItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountItem_stockCountId_productId_key" ON "StockCountItem"("stockCountId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_slug_key" ON "LandingPage"("slug");

-- CreateIndex
CREATE INDEX "LandingPage_status_publishedAt_idx" ON "LandingPage"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPageSection_landingPageId_position_key" ON "LandingPageSection"("landingPageId", "position");

-- CreateIndex
CREATE INDEX "PictogramPlacement_actionId_slot_idx" ON "PictogramPlacement"("actionId", "slot");

-- CreateIndex
CREATE INDEX "PictogramPlacement_landingPageId_slot_idx" ON "PictogramPlacement"("landingPageId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "MobileTab_position_key" ON "MobileTab"("position");

-- CreateIndex
CREATE INDEX "MobileTab_enabled_position_idx" ON "MobileTab"("enabled", "position");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_occurredAt_idx" ON "AnalyticsEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_anonymousId_occurredAt_idx" ON "AnalyticsEvent"("anonymousId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_productId_occurredAt_idx" ON "AnalyticsEvent"("productId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_orderId_idx" ON "AnalyticsEvent"("orderId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_expiresAt_idx" ON "AnalyticsEvent"("expiresAt");

-- CreateIndex
CREATE INDEX "NewsletterCampaign_status_scheduledAt_idx" ON "NewsletterCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AdminSavedView_adminUserId_module_isDefault_idx" ON "AdminSavedView"("adminUserId", "module", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSavedView_adminUserId_module_name_key" ON "AdminSavedView"("adminUserId", "module", "name");

-- CreateIndex
CREATE INDEX "Order_channel_createdAt_idx" ON "Order"("channel", "createdAt");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderItem_warehouseId_idx" ON "OrderItem"("warehouseId");

-- CreateIndex
CREATE INDEX "InboundInvoice_purchaseOrderId_idx" ON "InboundInvoice"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Reclamation_orderItemId_idx" ON "Reclamation"("orderItemId");

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_defaultPriceListId_fkey" FOREIGN KEY ("defaultPriceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_loadingLocationId_fkey" FOREIGN KEY ("loadingLocationId") REFERENCES "SupplierLoadingLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_receivingWarehouseId_fkey" FOREIGN KEY ("receivingWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_transportTypeId_fkey" FOREIGN KEY ("transportTypeId") REFERENCES "TransportType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundInvoice" ADD CONSTRAINT "InboundInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLookupAssignment" ADD CONSTRAINT "ProductLookupAssignment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLookupAssignment" ADD CONSTRAINT "ProductLookupAssignment_lookupValueId_fkey" FOREIGN KEY ("lookupValueId") REFERENCES "ProductLookupValue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierLoadingLocation" ADD CONSTRAINT "SupplierLoadingLocation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListEntry" ADD CONSTRAINT "PriceListEntry_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListEntry" ADD CONSTRAINT "PriceListEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProduct" ADD CONSTRAINT "ActionProduct_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionProduct" ADD CONSTRAINT "ActionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyPriceHistory" ADD CONSTRAINT "LoyaltyPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinearPromotionCategory" ADD CONSTRAINT "LinearPromotionCategory_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "LinearPromotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinearPromotionCategory" ADD CONSTRAINT "LinearPromotionCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinearPromotionGroup" ADD CONSTRAINT "LinearPromotionGroup_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "LinearPromotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinearPromotionGroup" ADD CONSTRAINT "LinearPromotionGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchNote" ADD CONSTRAINT "DispatchNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchNote" ADD CONSTRAINT "DispatchNote_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchNote" ADD CONSTRAINT "DispatchNote_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchNoteItem" ADD CONSTRAINT "DispatchNoteItem_dispatchNoteId_fkey" FOREIGN KEY ("dispatchNoteId") REFERENCES "DispatchNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchNoteItem" ADD CONSTRAINT "DispatchNoteItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchNoteItem" ADD CONSTRAINT "DispatchNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupBatchLine" ADD CONSTRAINT "PickupBatchLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PickupBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupBatchLine" ADD CONSTRAINT "PickupBatchLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupBatchLine" ADD CONSTRAINT "PickupBatchLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerReservation" ADD CONSTRAINT "PartnerReservation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "PartnerApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerReservation" ADD CONSTRAINT "PartnerReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountItem" ADD CONSTRAINT "StockCountItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPageSection" ADD CONSTRAINT "LandingPageSection_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PictogramPlacement" ADD CONSTRAINT "PictogramPlacement_pictogramId_fkey" FOREIGN KEY ("pictogramId") REFERENCES "Pictogram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PictogramPlacement" ADD CONSTRAINT "PictogramPlacement_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PictogramPlacement" ADD CONSTRAINT "PictogramPlacement_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileTab" ADD CONSTRAINT "MobileTab_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobileTab" ADD CONSTRAINT "MobileTab_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reclamation" ADD CONSTRAINT "Reclamation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSavedView" ADD CONSTRAINT "AdminSavedView_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
