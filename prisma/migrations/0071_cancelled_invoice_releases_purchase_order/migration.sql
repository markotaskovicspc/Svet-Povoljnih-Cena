-- A cancelled receipt remains linked for history, while a new active receipt
-- may be created for the same purchase order.
DROP INDEX IF EXISTS "InboundInvoice_purchaseOrderId_key";

CREATE UNIQUE INDEX "InboundInvoice_active_purchaseOrderId_key"
ON "InboundInvoice"("purchaseOrderId")
WHERE "purchaseOrderId" IS NOT NULL AND "status" <> 'CANCELLED';
