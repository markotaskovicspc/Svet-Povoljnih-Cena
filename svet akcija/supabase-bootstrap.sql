-- Run this AFTER supabase-prisma-schema.sql.
-- This is minimal operational bootstrap data for an empty Supabase database.
-- It does not seed catalog products; real checkout/wishlist/search feeds need Product rows.

-- 1) Create/reset the first admin outside SQL so no plaintext password or
-- password hash is committed. Use:
--
--   ADMIN_EMAIL="admin@example.com" \
--   ADMIN_PASSWORD="replace-with-a-strong-secret" \
--   ADMIN_ROLE="SUPER" \
--   npm run admin:create

-- 2) Payment method toggles used by /admin/placanje.
INSERT INTO "PaymentMethodConfig" ("method", "enabled", "label", "note", "updatedAt")
VALUES
  ('IPS', true, 'IPS QR', null, now()),
  ('KARTICA', true, 'Kartica', null, now()),
  ('GOOGLE_PAY', false, 'Google Pay', 'Enable after RaiAccept wallet setup is complete.', now()),
  ('APPLE_PAY', false, 'Apple Pay', 'Enable after RaiAccept wallet setup is complete.', now()),
  ('UPLATA_NA_RACUN', true, 'Uplata na racun', null, now()),
  ('POUZECE_GOTOVINA', true, 'Pouzece - gotovina', null, now()),
  ('POUZECE_KARTICA', true, 'Pouzece - kartica', null, now())
ON CONFLICT ("method") DO UPDATE SET
  "enabled" = EXCLUDED."enabled",
  "label" = EXCLUDED."label",
  "note" = EXCLUDED."note",
  "updatedAt" = now();

-- 3) Ad channel switches used by /admin/oglasi and feed generation.
INSERT INTO "AdFlag" ("id", "channel", "enabled", "budgetRsd", "updatedAt")
VALUES
  ('adflag-google-merchant', 'GOOGLE_MERCHANT', false, null, now()),
  ('adflag-meta', 'META', false, null, now()),
  ('adflag-tiktok', 'TIKTOK', false, null, now())
ON CONFLICT ("channel") DO UPDATE SET
  "enabled" = EXCLUDED."enabled",
  "budgetRsd" = EXCLUDED."budgetRsd",
  "updatedAt" = now();
