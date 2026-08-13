-- Rabalux catalog and stock imports are Serbian-market integrations. Keep the
-- authenticated download on the Serbian host so a foreign-market endpoint
-- cannot be configured accidentally. Product visibility is reconciled by the
-- audited stock sync, not by this migration.
UPDATE "Supplier"
SET
  "stockFeedUrl" = 'https://rabalux.rs/downloadmanager/downloadha/nohtml/1/id/11',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "integrationKey" = 'RABALUX';
