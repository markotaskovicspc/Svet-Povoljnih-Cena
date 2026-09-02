-- These indexes support the storefront media batch query, prioritized job
-- claiming, and daily retention cleanup. CONCURRENTLY keeps reads and writes
-- available while PostgreSQL builds each index in production.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ProductMedia_productId_kind_syncStatus_order_idx"
ON "ProductMedia"("productId", "kind", "syncStatus", "order");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_status_availableAt_createdAt_idx"
ON "BackgroundJob"("status", "availableAt", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_kind_status_availableAt_createdAt_idx"
ON "BackgroundJob"("kind", "status", "availableAt", "createdAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_status_completedAt_idx"
ON "BackgroundJob"("status", "completedAt");
