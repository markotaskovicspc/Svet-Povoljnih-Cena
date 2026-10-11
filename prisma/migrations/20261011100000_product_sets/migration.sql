CREATE TABLE "ProductSet" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "slug" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "description" TEXT NOT NULL DEFAULT '',
 "active" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ProductSet_slug_key" ON "ProductSet"("slug");
CREATE TABLE "ProductSetComponent" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "setId" TEXT NOT NULL REFERENCES "ProductSet"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 99),
 "unitPrice" DECIMAL(12,2) NOT NULL CHECK ("unitPrice" > 0),
 "position" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "ProductSetComponent_setId_productId_key" ON "ProductSetComponent"("setId", "productId");
CREATE INDEX "ProductSetComponent_productId_idx" ON "ProductSetComponent"("productId");
ALTER TABLE "Order" ADD COLUMN "checkoutLinesSnapshot" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "productSetName" TEXT;
ALTER TABLE "ProductSet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductSetComponent" ENABLE ROW LEVEL SECURITY;
-- db:deploy also runs db:harden to revoke Supabase Data API grants.
