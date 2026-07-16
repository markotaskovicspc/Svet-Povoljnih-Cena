-- Invalidate customer JWTs deterministically after password changes or
-- account deletion.
ALTER TABLE "User"
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Shared rate-limit state for serverless deployments.
CREATE TABLE "RateLimitBucket" (
  "key" VARCHAR(200) NOT NULL,
  "count" INTEGER NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- Durable post-commit work queue.
CREATE TABLE "BackgroundJob" (
  "id" TEXT NOT NULL,
  "kind" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BackgroundJob_idempotencyKey_key" ON "BackgroundJob"("idempotencyKey");
CREATE INDEX "BackgroundJob_status_availableAt_idx" ON "BackgroundJob"("status", "availableAt");
CREATE INDEX "BackgroundJob_lockedAt_idx" ON "BackgroundJob"("lockedAt");

-- Refund requests must be reserved before calling the payment gateway. An
-- ambiguous network result is held for manual reconciliation so it cannot be
-- submitted a second time accidentally.
ALTER TYPE "PaymentRefundStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';
ALTER TABLE "PaymentRefund" ADD COLUMN "idempotencyKey" VARCHAR(200);
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");
