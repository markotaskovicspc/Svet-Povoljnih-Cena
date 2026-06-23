-- Lightweight checkout-session tracking for admin insight into active,
-- converted, and abandoned checkout attempts. No card/payment credentials
-- or full addresses are stored here.

CREATE TYPE "CheckoutSessionStatus" AS ENUM (
    'ACTIVE',
    'CONVERTED',
    'ABANDONED'
);

CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestEmail" TEXT,
    "identity" TEXT,
    "step" TEXT NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "itemQty" INTEGER NOT NULL DEFAULT 0,
    "cartTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shippingCity" TEXT,
    "shippingMethod" "ShippingMethod",
    "paymentMethod" "PaymentMethod",
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CheckoutSession_status_updatedAt_idx" ON "CheckoutSession"("status", "updatedAt");
CREATE INDEX "CheckoutSession_userId_updatedAt_idx" ON "CheckoutSession"("userId", "updatedAt");
CREATE INDEX "CheckoutSession_guestEmail_idx" ON "CheckoutSession"("guestEmail");
CREATE INDEX "CheckoutSession_orderId_idx" ON "CheckoutSession"("orderId");

ALTER TABLE "CheckoutSession"
ADD CONSTRAINT "CheckoutSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CheckoutSession"
ADD CONSTRAINT "CheckoutSession_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
