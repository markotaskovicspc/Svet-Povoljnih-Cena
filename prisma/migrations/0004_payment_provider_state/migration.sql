CREATE TYPE "PaymentProvider" AS ENUM ('IPS', 'RAIFFEISEN_CARD', 'WSPAY', 'MANUAL', 'COD');

ALTER TABLE "Payment"
ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "paymentReference" TEXT,
ADD COLUMN "redirectUrl" TEXT,
ADD COLUMN "rawRequest" JSONB,
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "Payment"
SET "provider" = CASE
  WHEN "method" = 'IPS' THEN 'IPS'::"PaymentProvider"
  WHEN "method" IN ('KARTICA', 'GOOGLE_PAY', 'APPLE_PAY') THEN 'WSPAY'::"PaymentProvider"
  WHEN "method" IN ('POUZECE_GOTOVINA', 'POUZECE_KARTICA') THEN 'COD'::"PaymentProvider"
  ELSE 'MANUAL'::"PaymentProvider"
END;

CREATE INDEX "Payment_paymentReference_idx" ON "Payment"("paymentReference");
CREATE INDEX "Payment_provider_status_idx" ON "Payment"("provider", "status");
