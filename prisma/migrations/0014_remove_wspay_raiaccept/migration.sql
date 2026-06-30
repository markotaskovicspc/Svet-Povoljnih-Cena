UPDATE "Payment"
SET "provider" = 'RAIFFEISEN_CARD'
WHERE "provider" = 'WSPAY';

UPDATE "PaymentRefund"
SET "provider" = 'RAIFFEISEN_CARD'
WHERE "provider" = 'WSPAY';

ALTER TABLE "SavedCard"
RENAME COLUMN "wsPayToken" TO "providerToken";

ALTER INDEX "SavedCard_wsPayToken_key"
RENAME TO "SavedCard_providerToken_key";

ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
CREATE TYPE "PaymentProvider" AS ENUM ('IPS', 'RAIFFEISEN_CARD', 'MANUAL', 'COD');

ALTER TABLE "Payment"
ALTER COLUMN "provider" DROP DEFAULT,
ALTER COLUMN "provider" TYPE "PaymentProvider"
USING "provider"::text::"PaymentProvider",
ALTER COLUMN "provider" SET DEFAULT 'MANUAL';

ALTER TABLE "PaymentRefund"
ALTER COLUMN "provider" DROP DEFAULT,
ALTER COLUMN "provider" TYPE "PaymentProvider"
USING "provider"::text::"PaymentProvider",
ALTER COLUMN "provider" SET DEFAULT 'MANUAL';

DROP TYPE "PaymentProvider_old";
