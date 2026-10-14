ALTER TABLE "PurchaseOrder" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "PurchaseOrder_archivedAt_createdAt_idx" ON "PurchaseOrder"("archivedAt", "createdAt");
