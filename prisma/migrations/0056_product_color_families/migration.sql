-- Product colour families group independent ERP products without replacing
-- their SKU-level stock, pricing history, orders or supplier ownership.
CREATE TABLE "ProductFamily" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "primaryProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFamily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductFamilyMember" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelKey" TEXT NOT NULL,
    "colorHex" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "storefrontEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFamilyMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductFamily_code_key" ON "ProductFamily"("code");
CREATE UNIQUE INDEX "ProductFamily_primaryProductId_key" ON "ProductFamily"("primaryProductId");
CREATE INDEX "ProductFamily_code_idx" ON "ProductFamily"("code");
CREATE UNIQUE INDEX "ProductFamilyMember_productId_key" ON "ProductFamilyMember"("productId");
CREATE UNIQUE INDEX "ProductFamilyMember_familyId_labelKey_key" ON "ProductFamilyMember"("familyId", "labelKey");
CREATE INDEX "ProductFamilyMember_familyId_position_productId_idx" ON "ProductFamilyMember"("familyId", "position", "productId");
CREATE INDEX "ProductFamilyMember_storefrontEnabled_idx" ON "ProductFamilyMember"("storefrontEnabled");

ALTER TABLE "ProductFamily"
  ADD CONSTRAINT "ProductFamily_primaryProductId_fkey"
  FOREIGN KEY ("primaryProductId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductFamilyMember"
  ADD CONSTRAINT "ProductFamilyMember_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "ProductFamily"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductFamilyMember"
  ADD CONSTRAINT "ProductFamilyMember_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
