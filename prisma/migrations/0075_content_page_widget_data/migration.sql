ALTER TABLE "ContentPage"
  ADD COLUMN "widgetData" JSONB;

ALTER TABLE "ContentPageRevision"
  ADD COLUMN "widgetData" JSONB;
