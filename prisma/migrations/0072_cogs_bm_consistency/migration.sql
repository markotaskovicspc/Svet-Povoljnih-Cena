-- Client rule: purchase-order transport is allocated by calculated volume.
-- Keep received/cancelled history unchanged; only open orders adopt the rule.
ALTER TABLE "PurchaseOrder"
  ALTER COLUMN "allocationBasis" SET DEFAULT 'VOLUME';

UPDATE "PurchaseOrder"
SET "allocationBasis" = 'VOLUME'
WHERE "status" IN ('DRAFT', 'SENT', 'CONFIRMED')
  AND "allocationBasis" = 'AUTO_UTILIZATION';

-- On inbound invoices this field controls only other related costs. Transport
-- has its fixed volume basis, while VALUE is the safest editable default.
ALTER TABLE "InboundInvoice"
  ALTER COLUMN "allocationBasis" SET DEFAULT 'VALUE';

UPDATE "InboundInvoice"
SET "allocationBasis" = 'VALUE'
WHERE "status" IN ('DRAFT', 'RECEIVED')
  AND "allocationBasis" IN ('AUTO_UTILIZATION', 'MANUAL');
