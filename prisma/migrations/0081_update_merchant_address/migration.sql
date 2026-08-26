-- Keep the persisted Contact page aligned with the current legal merchant
-- address while preserving every other channel and its custom settings.
WITH contact_pages AS (
  SELECT
    p."id",
    p."draftRevisionId",
    p."publishedRevisionId"
  FROM "ContentPage" p
  WHERE p."slug" = 'kontakt'
),
updated_page_widgets AS (
  SELECT
    p."id",
    jsonb_set(
      p."widgetData"::jsonb,
      '{channels}',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN channel.item->>'id' = 'merchant' THEN
                jsonb_set(
                  channel.item,
                  '{value}',
                  to_jsonb('Jurija Gagarina 32, 11070 Novi Beograd'::text),
                  true
                )
              ELSE channel.item
            END
            ORDER BY channel.ordinality
          )
          FROM jsonb_array_elements(p."widgetData"::jsonb->'channels')
            WITH ORDINALITY AS channel(item, ordinality)
        ),
        '[]'::jsonb
      ),
      true
    ) AS widget_data
  FROM "ContentPage" p
  JOIN contact_pages contact ON contact."id" = p."id"
  WHERE p."widgetData" IS NOT NULL
    AND jsonb_typeof(p."widgetData"::jsonb->'channels') = 'array'
)
UPDATE "ContentPage" p
SET
  "widgetData" = updated.widget_data,
  "updatedAt" = CURRENT_TIMESTAMP
FROM updated_page_widgets updated
WHERE p."id" = updated."id";

WITH active_contact_revisions AS (
  SELECT DISTINCT revision_id
  FROM "ContentPage" p
  CROSS JOIN LATERAL unnest(
    ARRAY[p."draftRevisionId", p."publishedRevisionId"]
  ) AS active(revision_id)
  WHERE p."slug" = 'kontakt'
    AND revision_id IS NOT NULL
),
updated_revision_widgets AS (
  SELECT
    r."id",
    jsonb_set(
      r."widgetData"::jsonb,
      '{channels}',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN channel.item->>'id' = 'merchant' THEN
                jsonb_set(
                  channel.item,
                  '{value}',
                  to_jsonb('Jurija Gagarina 32, 11070 Novi Beograd'::text),
                  true
                )
              ELSE channel.item
            END
            ORDER BY channel.ordinality
          )
          FROM jsonb_array_elements(r."widgetData"::jsonb->'channels')
            WITH ORDINALITY AS channel(item, ordinality)
        ),
        '[]'::jsonb
      ),
      true
    ) AS widget_data
  FROM "ContentPageRevision" r
  JOIN active_contact_revisions active ON active.revision_id = r."id"
  WHERE r."widgetData" IS NOT NULL
    AND jsonb_typeof(r."widgetData"::jsonb->'channels') = 'array'
)
UPDATE "ContentPageRevision" r
SET "widgetData" = updated.widget_data
FROM updated_revision_widgets updated
WHERE r."id" = updated."id";
