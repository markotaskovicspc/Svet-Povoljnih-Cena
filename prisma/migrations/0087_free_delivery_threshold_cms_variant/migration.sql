UPDATE "ContentPage"
SET "bodyMarkdown" = REPLACE(
  "bodyMarkdown",
  'Dostava artikala I kategorije je besplatna kada njihov zbir prelazi 2.000 RSD.',
  'Od 1. septembra 2026. u 00:01, dostava artikala I kategorije je besplatna kada njihov zbir iznosi 4.000 RSD ili više.'
)
WHERE "slug" = 'uslovi-isporuke'
  AND "bodyMarkdown" LIKE '%Dostava artikala I kategorije je besplatna kada njihov zbir prelazi 2.000 RSD.%';

UPDATE "ContentPageRevision"
SET "bodyMarkdown" = REPLACE(
  "bodyMarkdown",
  'Dostava artikala I kategorije je besplatna kada njihov zbir prelazi 2.000 RSD.',
  'Od 1. septembra 2026. u 00:01, dostava artikala I kategorije je besplatna kada njihov zbir iznosi 4.000 RSD ili više.'
)
WHERE "pageId" IN (
  SELECT "id" FROM "ContentPage" WHERE "slug" = 'uslovi-isporuke'
)
  AND "bodyMarkdown" LIKE '%Dostava artikala I kategorije je besplatna kada njihov zbir prelazi 2.000 RSD.%';
