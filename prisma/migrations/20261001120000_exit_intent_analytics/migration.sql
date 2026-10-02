-- Reuse consented analytics storage and its existing RLS/retention policy.
ALTER TYPE "AnalyticsEventType" ADD VALUE IF NOT EXISTS 'EXIT_INTENT';
