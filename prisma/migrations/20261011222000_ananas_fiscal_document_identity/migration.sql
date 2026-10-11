BEGIN;
-- A refund's invoiceId may identify the original sale, not the correction.
-- Retain the existing unique fiscal-number key and all posted document ids.
DROP INDEX "AnanasDocument_kind_externalId_key";
CREATE INDEX "AnanasDocument_kind_externalId_idx" ON "AnanasDocument"("kind", "externalId");
COMMIT;
