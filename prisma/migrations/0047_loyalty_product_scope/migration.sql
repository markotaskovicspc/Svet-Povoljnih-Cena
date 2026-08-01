CREATE TYPE "LoyaltyScope" AS ENUM ('SELECTED_PRODUCTS', 'ALL_PRODUCTS');

ALTER TABLE "LoyaltyRule"
  ADD COLUMN "scope" "LoyaltyScope" NOT NULL DEFAULT 'SELECTED_PRODUCTS';

CREATE TABLE "LoyaltyRuleProduct" (
  "loyaltyRuleId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyRuleProduct_pkey" PRIMARY KEY ("loyaltyRuleId", "productId")
);

CREATE INDEX "LoyaltyRuleProduct_productId_idx"
  ON "LoyaltyRuleProduct"("productId");

ALTER TABLE "LoyaltyRuleProduct"
  ADD CONSTRAINT "LoyaltyRuleProduct_loyaltyRuleId_fkey"
  FOREIGN KEY ("loyaltyRuleId") REFERENCES "LoyaltyRule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LoyaltyRuleProduct"
  ADD CONSTRAINT "LoyaltyRuleProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing rules deliberately remain SELECTED_PRODUCTS with no memberships.
-- This makes the previously global 30% rule apply to nobody until an admin
-- explicitly chooses products.
