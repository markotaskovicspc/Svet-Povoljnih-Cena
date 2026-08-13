CREATE TABLE "MobileSearchConfig" (
    "key" TEXT NOT NULL,
    "viewAllHref" TEXT NOT NULL DEFAULT '/akcija',
    "frequentQueries" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileSearchConfig_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "MobileSearchCurrentItem" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "actionId" TEXT,
    "landingPageId" TEXT,
    "href" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MobileSearchCurrentItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MobileSearchCurrentItem_position_check" CHECK ("position" BETWEEN 1 AND 2),
    CONSTRAINT "MobileSearchCurrentItem_single_destination_check" CHECK (
      (("actionId" IS NOT NULL)::int + ("landingPageId" IS NOT NULL)::int + ("href" IS NOT NULL)::int) <= 1
    )
);

CREATE TABLE "MobileSearchProduct" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    CONSTRAINT "MobileSearchProduct_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MobileSearchProduct_position_check" CHECK ("position" BETWEEN 1 AND 4)
);

CREATE UNIQUE INDEX "MobileSearchCurrentItem_configKey_position_key"
ON "MobileSearchCurrentItem"("configKey", "position");
CREATE INDEX "MobileSearchCurrentItem_actionId_idx"
ON "MobileSearchCurrentItem"("actionId");
CREATE INDEX "MobileSearchCurrentItem_landingPageId_idx"
ON "MobileSearchCurrentItem"("landingPageId");

CREATE UNIQUE INDEX "MobileSearchProduct_configKey_position_key"
ON "MobileSearchProduct"("configKey", "position");
CREATE UNIQUE INDEX "MobileSearchProduct_configKey_productId_key"
ON "MobileSearchProduct"("configKey", "productId");
CREATE INDEX "MobileSearchProduct_productId_idx"
ON "MobileSearchProduct"("productId");

ALTER TABLE "MobileSearchCurrentItem"
ADD CONSTRAINT "MobileSearchCurrentItem_configKey_fkey"
FOREIGN KEY ("configKey") REFERENCES "MobileSearchConfig"("key") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobileSearchCurrentItem"
ADD CONSTRAINT "MobileSearchCurrentItem_actionId_fkey"
FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MobileSearchCurrentItem"
ADD CONSTRAINT "MobileSearchCurrentItem_landingPageId_fkey"
FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MobileSearchProduct"
ADD CONSTRAINT "MobileSearchProduct_configKey_fkey"
FOREIGN KEY ("configKey") REFERENCES "MobileSearchConfig"("key") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobileSearchProduct"
ADD CONSTRAINT "MobileSearchProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
