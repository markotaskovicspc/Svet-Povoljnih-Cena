-- Versioned visual landing-page builder. Existing LandingPageSection rows remain
-- available as a compatibility fallback until they are saved through the editor.
ALTER TABLE "LandingPage"
  ADD COLUMN "heroMobileImageUrl" TEXT,
  ADD COLUMN "heroImageAlt" TEXT,
  ADD COLUMN "heroCtaLabel" TEXT,
  ADD COLUMN "heroCtaHref" TEXT,
  ADD COLUMN "ogImageUrl" TEXT,
  ADD COLUMN "canonicalUrl" TEXT,
  ADD COLUMN "robotsIndex" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "blocks" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "draftRevisionId" TEXT,
  ADD COLUMN "publishedRevisionId" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "LandingPageRevision" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LandingPageRevision_pkey" PRIMARY KEY ("id")
);

-- Preserve every existing page as revision 1. Its legacy sections are still
-- rendered when the blocks array is empty, and are converted on first save.
INSERT INTO "LandingPageRevision" ("id", "pageId", "version", "snapshot", "createdAt")
SELECT
  "id" || '-revision-1',
  "id",
  1,
  jsonb_build_object(
    'legacySectionsFallback', true,
    'title', "title",
    'lead', "lead",
    'heroImageUrl', "heroImageUrl",
    'heroMobileImageUrl', NULL,
    'heroImageAlt', NULL,
    'heroCtaLabel', NULL,
    'heroCtaHref', NULL,
    'heroPictograms', jsonb_build_object(
      'TOP_LEFT_1', NULL,
      'TOP_LEFT_2', NULL,
      'BOTTOM_RIGHT_1', NULL,
      'BOTTOM_RIGHT_2', NULL
    ),
    'blocks', '[]'::jsonb,
    'seoTitle', "seoTitle",
    'seoDescription', "seoDescription",
    'ogImageUrl', NULL,
    'canonicalUrl', NULL,
    'robotsIndex', true,
    'startsAt', CASE WHEN "startsAt" IS NULL THEN NULL ELSE to_char("startsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'endsAt', CASE WHEN "endsAt" IS NULL THEN NULL ELSE to_char("endsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
  ),
  "updatedAt"
FROM "LandingPage";

UPDATE "LandingPage"
SET
  "draftRevisionId" = "id" || '-revision-1',
  "publishedRevisionId" = CASE
    WHEN "status" = 'PUBLISHED' THEN "id" || '-revision-1'
    ELSE NULL
  END;

CREATE UNIQUE INDEX "LandingPage_draftRevisionId_key" ON "LandingPage"("draftRevisionId");
CREATE UNIQUE INDEX "LandingPage_publishedRevisionId_key" ON "LandingPage"("publishedRevisionId");
CREATE INDEX "LandingPage_status_startsAt_endsAt_idx" ON "LandingPage"("status", "startsAt", "endsAt");
CREATE INDEX "LandingPage_archivedAt_updatedAt_idx" ON "LandingPage"("archivedAt", "updatedAt");
CREATE UNIQUE INDEX "LandingPageRevision_pageId_version_key" ON "LandingPageRevision"("pageId", "version");
CREATE INDEX "LandingPageRevision_pageId_createdAt_idx" ON "LandingPageRevision"("pageId", "createdAt");
CREATE INDEX "LandingPageRevision_createdById_createdAt_idx" ON "LandingPageRevision"("createdById", "createdAt");

-- A target can display at most one pictogram in each controlled slot.
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "actionId", "slot" ORDER BY "createdAt", "id"
  ) AS row_number
  FROM "PictogramPlacement"
  WHERE "actionId" IS NOT NULL
)
DELETE FROM "PictogramPlacement"
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "landingPageId", "slot" ORDER BY "createdAt", "id"
  ) AS row_number
  FROM "PictogramPlacement"
  WHERE "landingPageId" IS NOT NULL
)
DELETE FROM "PictogramPlacement"
WHERE "id" IN (SELECT "id" FROM ranked WHERE row_number > 1);

CREATE UNIQUE INDEX "PictogramPlacement_actionId_slot_key"
  ON "PictogramPlacement"("actionId", "slot") WHERE "actionId" IS NOT NULL;
CREATE UNIQUE INDEX "PictogramPlacement_landingPageId_slot_key"
  ON "PictogramPlacement"("landingPageId", "slot") WHERE "landingPageId" IS NOT NULL;

ALTER TABLE "LandingPageRevision"
  ADD CONSTRAINT "LandingPageRevision_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "LandingPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LandingPageRevision"
  ADD CONSTRAINT "LandingPageRevision_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LandingPage"
  ADD CONSTRAINT "LandingPage_draftRevisionId_fkey"
  FOREIGN KEY ("draftRevisionId") REFERENCES "LandingPageRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LandingPage"
  ADD CONSTRAINT "LandingPage_publishedRevisionId_fkey"
  FOREIGN KEY ("publishedRevisionId") REFERENCES "LandingPageRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
