CREATE TYPE "SupplierProductApprovalStatus" AS ENUM (
  'PENDING_MAPPING',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED'
);

CREATE TYPE "SupplierSyncChangeStatus" AS ENUM (
  'PREVIEW',
  'PENDING',
  'APPLIED',
  'REVERTED',
  'SKIPPED',
  'CONFLICT'
);

ALTER TABLE "Product"
  ADD COLUMN "supplierApprovalStatus" "SupplierProductApprovalStatus",
  ADD COLUMN "supplierApprovedAt" TIMESTAMP(3),
  ADD COLUMN "supplierApprovedById" TEXT,
  ADD COLUMN "supplierCatalogMissingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "supplierCatalogMissingSince" TIMESTAMP(3),
  ADD COLUMN "supplierStockMissingCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "supplierStockMissingSince" TIMESTAMP(3),
  ADD COLUMN "lastSupplierSyncAt" TIMESTAMP(3),
  ADD COLUMN "lastSupplierSourceHash" TEXT;

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_supplier_missing_counts_nonnegative"
  CHECK (
    "supplierCatalogMissingCount" >= 0
    AND "supplierStockMissingCount" >= 0
  );

ALTER TABLE "ImportRun"
  ADD COLUMN "sourceHash" TEXT,
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "previewRunId" TEXT,
  ADD COLUMN "requestedById" TEXT,
  ADD COLUMN "rollbackOfId" TEXT;

CREATE TABLE "SupplierSyncLease" (
  "supplierId" TEXT NOT NULL,
  "scope" VARCHAR(32) NOT NULL,
  "ownerRunId" TEXT NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierSyncLease_pkey" PRIMARY KEY ("supplierId", "scope")
);

CREATE TABLE "SupplierCategoryMapping" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "externalCategory" TEXT NOT NULL,
  "externalType" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierCategoryMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierSyncChange" (
  "id" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "importRunId" TEXT NOT NULL,
  "productId" TEXT,
  "externalSku" TEXT NOT NULL,
  "changeType" VARCHAR(40) NOT NULL,
  "status" "SupplierSyncChangeStatus" NOT NULL DEFAULT 'PREVIEW',
  "fieldNames" TEXT[] NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "reversible" BOOLEAN NOT NULL DEFAULT TRUE,
  "reason" TEXT,
  "appliedAt" TIMESTAMP(3),
  "revertedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupplierSyncChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Product_supplierId_supplierApprovalStatus_idx"
  ON "Product"("supplierId", "supplierApprovalStatus");
CREATE INDEX "ImportRun_supplierId_kind_status_startedAt_idx"
  ON "ImportRun"("supplierId", "kind", "status", "startedAt");
CREATE INDEX "SupplierSyncLease_expiresAt_idx"
  ON "SupplierSyncLease"("expiresAt");
CREATE UNIQUE INDEX "SupplierCategoryMapping_supplierId_externalCategory_externalType_key"
  ON "SupplierCategoryMapping"("supplierId", "externalCategory", "externalType");
CREATE INDEX "SupplierCategoryMapping_categoryId_idx"
  ON "SupplierCategoryMapping"("categoryId");
CREATE INDEX "SupplierSyncChange_importRunId_status_idx"
  ON "SupplierSyncChange"("importRunId", "status");
CREATE INDEX "SupplierSyncChange_supplierId_status_createdAt_idx"
  ON "SupplierSyncChange"("supplierId", "status", "createdAt");
CREATE INDEX "SupplierSyncChange_productId_createdAt_idx"
  ON "SupplierSyncChange"("productId", "createdAt");
CREATE INDEX "SupplierSyncChange_externalSku_idx"
  ON "SupplierSyncChange"("externalSku");

ALTER TABLE "SupplierSyncLease"
  ADD CONSTRAINT "SupplierSyncLease_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCategoryMapping"
  ADD CONSTRAINT "SupplierCategoryMapping_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierCategoryMapping"
  ADD CONSTRAINT "SupplierCategoryMapping_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierSyncChange"
  ADD CONSTRAINT "SupplierSyncChange_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierSyncChange"
  ADD CONSTRAINT "SupplierSyncChange_importRunId_fkey"
  FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierSyncChange"
  ADD CONSTRAINT "SupplierSyncChange_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing Rabalux products were already public before this approval workflow.
-- Preserve that reviewed production state while making every future product
-- pending by default in importer code.
UPDATE "Product" p
   SET "supplierApprovalStatus" = 'APPROVED',
       "supplierApprovedAt" = CURRENT_TIMESTAMP
  FROM "Supplier" s
 WHERE p."supplierId" = s."id"
   AND s."integrationKey" = 'RABALUX';

UPDATE "ProductMedia" pm
   SET "sourceUrl" = regexp_replace(pm."sourceUrl", '^http://', 'https://', 'i')
  FROM "Product" p
  JOIN "Supplier" s ON s."id" = p."supplierId" AND s."integrationKey" = 'RABALUX'
 WHERE pm."productId" = p."id"
   AND pm."sourceUrl" ~* '^http://rabaluxkep\.plugin\.hu/';

UPDATE "ProductAttachment" pa
   SET "sourceUrl" = regexp_replace(pa."sourceUrl", '^http://', 'https://', 'i')
  FROM "Product" p
  JOIN "Supplier" s ON s."id" = p."supplierId" AND s."integrationKey" = 'RABALUX'
 WHERE pa."productId" = p."id"
   AND pa."sourceUrl" ~* '^http://rabaluxkep\.plugin\.hu/';

-- Files rejected by the storage size ceiling cannot succeed through retries.
-- Quarantine the known permanent backlog; a changed feed asset receives a new
-- asset/job id and may be processed normally.
UPDATE "BackgroundJob"
   SET "status" = 'FAILED',
       "lockedAt" = NULL,
       "availableAt" = CURRENT_TIMESTAMP,
       "lastError" = CASE
         WHEN "lastError" LIKE '[permanent]%' THEN "lastError"
         ELSE '[permanent] ' || COALESCE("lastError", 'Rabalux media exceeds storage limit.')
       END,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "kind" = 'RABALUX_MEDIA_PRODUCT'
   AND "status" IN ('QUEUED', 'RETRY', 'RUNNING')
   AND COALESCE("lastError", '') ~* '(413|payload too large|maximum allowed size|entity too large)';

-- Seed explicit mappings from the taxonomy currently assigned to reviewed
-- Rabalux products. Unknown future category/type pairs remain unmapped.
INSERT INTO "SupplierCategoryMapping" (
  "id",
  "supplierId",
  "externalCategory",
  "externalType",
  "categoryId",
  "enabled",
  "createdAt",
  "updatedAt"
)
SELECT DISTINCT ON (s."id", COALESCE(parent."name", c."name"), COALESCE(g."name", c."name"))
  md5(random()::text || clock_timestamp()::text || p."id"),
  s."id",
  COALESCE(parent."name", c."name"),
  COALESCE(g."name", c."name"),
  c."id",
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Product" p
JOIN "Supplier" s ON s."id" = p."supplierId" AND s."integrationKey" = 'RABALUX'
JOIN "ProductCategory" pc ON pc."productId" = p."id"
JOIN "Category" c ON c."id" = pc."categoryId"
LEFT JOIN "Category" parent ON parent."id" = c."parentId"
LEFT JOIN "Group" g ON g."id" = p."groupId"
ORDER BY s."id", COALESCE(parent."name", c."name"), COALESCE(g."name", c."name"), p."updatedAt" DESC
ON CONFLICT ("supplierId", "externalCategory", "externalType") DO NOTHING;
