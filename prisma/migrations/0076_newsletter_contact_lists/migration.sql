-- Imported contact lists are lightweight, reusable tags. A contact may belong
-- to more than one list without overwriting its original consent source.
ALTER TABLE "MarketingContact"
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "MarketingContact_tags_idx"
  ON "MarketingContact" USING GIN ("tags");
