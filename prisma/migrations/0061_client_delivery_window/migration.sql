INSERT INTO "AdminSetting" ("key", "value", "updatedAt")
VALUES (
  'delivery.windows',
  '{"dc":{"min":3,"max":5},"supplier":{"min":2,"max":3}}'::jsonb,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET "value" = jsonb_set(
  COALESCE("AdminSetting"."value", '{}'::jsonb),
  '{supplier}',
  '{"min":2,"max":3}'::jsonb,
  true
),
"updatedAt" = CURRENT_TIMESTAMP;
