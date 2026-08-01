-- Pricing datetime-local controls historically sent Serbian wall-clock values
-- which Vercel parsed as UTC. Reinterpret those stored clock components in
-- Europe/Belgrade so existing actions and rules keep the time admins entered.

UPDATE "Action"
SET
  "startsAt" = ("startsAt" AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'UTC',
  "endsAt" = ("endsAt" AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'UTC';

UPDATE "LoyaltyRule"
SET
  "startsAt" = CASE
    WHEN "startsAt" IS NULL THEN NULL
    ELSE ("startsAt" AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'UTC'
  END,
  "endsAt" = CASE
    WHEN "endsAt" IS NULL THEN NULL
    ELSE ("endsAt" AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'UTC'
  END;

UPDATE "LinearPromotion"
SET
  "startsAt" = ("startsAt" AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'UTC',
  "endsAt" = ("endsAt" AT TIME ZONE 'Europe/Belgrade') AT TIME ZONE 'UTC';
