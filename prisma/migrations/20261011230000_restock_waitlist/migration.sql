CREATE TABLE "RestockSubscription" (
 "id" TEXT NOT NULL, "email" TEXT NOT NULL, "userId" TEXT, "productId" TEXT NOT NULL,
 "source" TEXT NOT NULL DEFAULT 'PRODUCT', "status" TEXT NOT NULL DEFAULT 'PENDING',
 "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "notifiedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "sendStartedAt" TIMESTAMP(3), "messageId" TEXT,
 CONSTRAINT "RestockSubscription_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "RestockSubscription_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RestockSubscription_email_productId_key" ON "RestockSubscription"("email", "productId");
CREATE INDEX "RestockSubscription_status_checkedAt_idx" ON "RestockSubscription"("status", "checkedAt");
CREATE INDEX "RestockSubscription_productId_status_idx" ON "RestockSubscription"("productId", "status");
CREATE INDEX "RestockSubscription_userId_idx" ON "RestockSubscription"("userId");
ALTER TABLE "RestockSubscription" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "RestockSubscription" FROM anon, authenticated;
