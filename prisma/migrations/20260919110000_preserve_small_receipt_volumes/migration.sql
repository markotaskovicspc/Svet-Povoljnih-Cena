-- Preserve existing snapshots; no historical receipts are recalculated here.
-- Keep the wider columns if rolling application code back: narrowing to three
-- decimal places would discard newly stored small volumes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- AlterTable
ALTER TABLE "PurchaseOrder" ALTER COLUMN "totalVolume" SET DATA TYPE DECIMAL(18,9);

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "totalVolume" SET DATA TYPE DECIMAL(18,9);

COMMIT;
