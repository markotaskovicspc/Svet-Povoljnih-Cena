-- Seed the four mobile-homepage shortcut positions. Existing administrator
-- choices win, so this migration is safe on already configured databases.
INSERT INTO "MobileTab" (
  "id",
  "label",
  "icon",
  "position",
  "enabled",
  "href",
  "createdAt",
  "updatedAt"
)
VALUES
  ('mobile-shortcut-monthly-action', 'Mesečna akcija', '/brand/promo-stickers/akcija.svg', 1, true, '/akcija', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mobile-shortcut-heroes', 'Heroji meseca', '/brand/heroji-meseca.png', 2, true, '/heroji-meseca', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mobile-shortcut-protected-prices', 'Trajno niske cene', '/brand/tnc-black.svg', 3, true, '/niske-cene-pod-zastitom', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mobile-shortcut-limited', 'Dok traju zalihe', '/brand/promo-stickers/dtz2.svg', 4, true, '/ogranicena-ponuda', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("position") DO NOTHING;
