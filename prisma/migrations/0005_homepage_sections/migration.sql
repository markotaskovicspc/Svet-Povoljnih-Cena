CREATE TYPE "BannerPlacement" AS ENUM ('HERO', 'HOME_AFTER_SECOND_ROW', 'HOME_AFTER_FOURTH_ROW');

CREATE TYPE "HomeSectionSlotKey" AS ENUM ('FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH');

CREATE TYPE "HomeSectionSourceType" AS ENUM ('ACTION', 'LANDING_PAGE');

ALTER TABLE "Banner"
ADD COLUMN "placement" "BannerPlacement" NOT NULL DEFAULT 'HERO';

CREATE TABLE "HomeSectionSlot" (
    "id" TEXT NOT NULL,
    "slotKey" "HomeSectionSlotKey" NOT NULL,
    "sourceType" "HomeSectionSourceType" NOT NULL,
    "actionId" TEXT,
    "landingPageKey" TEXT,
    "titleOverride" TEXT,
    "productLimit" INTEGER NOT NULL DEFAULT 12,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeSectionSlot_pkey" PRIMARY KEY ("id")
);

DROP INDEX "Banner_enabled_order_idx";
CREATE INDEX "Banner_enabled_placement_order_idx" ON "Banner"("enabled", "placement", "order");

CREATE UNIQUE INDEX "HomeSectionSlot_slotKey_key" ON "HomeSectionSlot"("slotKey");
CREATE INDEX "HomeSectionSlot_enabled_slotKey_idx" ON "HomeSectionSlot"("enabled", "slotKey");
CREATE INDEX "HomeSectionSlot_actionId_idx" ON "HomeSectionSlot"("actionId");

ALTER TABLE "HomeSectionSlot"
ADD CONSTRAINT "HomeSectionSlot_actionId_fkey"
FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;
