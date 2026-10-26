-- Preserve existing accounts: NULL continues to use legacy roles.
ALTER TYPE "AdminRoleName" ADD VALUE IF NOT EXISTS 'CUSTOM';
ALTER TABLE "AdminUser" ADD COLUMN "accessPolicy" JSONB;
