ALTER TABLE "Tab" ADD COLUMN "pictogramId" TEXT;

-- Legacy navigation data used positions 0–9 while the admin editor and customer-facing
-- language use positions 1–10. Shift only a complete legacy range, never mixed data.
UPDATE "Tab"
SET "order" = "order" + 1
WHERE EXISTS (SELECT 1 FROM "Tab" WHERE "order" = 0)
  AND NOT EXISTS (SELECT 1 FROM "Tab" WHERE "order" > 9);

CREATE INDEX "Tab_pictogramId_idx" ON "Tab"("pictogramId");

ALTER TABLE "Tab"
ADD CONSTRAINT "Tab_pictogramId_fkey"
FOREIGN KEY ("pictogramId") REFERENCES "Pictogram"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
