INSERT INTO "Group" ("id", "slug", "name")
SELECT
  'grp-category-' || md5(category."id"),
  category."slug",
  category."name"
FROM "Category" AS category
WHERE NOT EXISTS (
  SELECT 1
  FROM "Group" AS existing_group
  WHERE existing_group."slug" = category."slug"
     OR lower(btrim(existing_group."name")) = lower(btrim(category."name"))
)
ON CONFLICT DO NOTHING;
