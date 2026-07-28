CREATE TYPE "ContentPageKind" AS ENUM ('SYSTEM', 'CUSTOM');
CREATE TYPE "ContentPageTemplate" AS ENUM ('STANDARD', 'FAQ');
CREATE TYPE "ContentFooterColumn" AS ENUM ('COMPANY', 'TERMS');

ALTER TABLE "ContentPage"
  ADD COLUMN "systemKey" TEXT,
  ADD COLUMN "kind" "ContentPageKind" NOT NULL DEFAULT 'CUSTOM',
  ADD COLUMN "template" "ContentPageTemplate" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "eyebrow" TEXT,
  ADD COLUMN "heroNote" TEXT,
  ADD COLUMN "footerVisible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "footerLabel" TEXT,
  ADD COLUMN "footerColumn" "ContentFooterColumn",
  ADD COLUMN "footerOrder" INTEGER,
  ADD COLUMN "draftRevisionId" TEXT,
  ADD COLUMN "publishedRevisionId" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "ContentPage" ALTER COLUMN "published" SET DEFAULT false;

UPDATE "ContentPage"
SET
  "kind" = 'SYSTEM',
  "systemKey" = "slug",
  "template" = CASE
    WHEN "slug" = 'pomoc' THEN 'FAQ'::"ContentPageTemplate"
    ELSE 'STANDARD'::"ContentPageTemplate"
  END
WHERE "slug" IN (
  'o-nama',
  'pomoc',
  'reklamacije',
  'uslovi-koriscenja',
  'uslovi-isporuke',
  'uslovi-kupovine',
  'politika-privatnosti',
  'brisanje-podataka'
);

CREATE TABLE "ContentPageRevision" (
  "id" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "eyebrow" TEXT,
  "heroNote" TEXT,
  "title" TEXT NOT NULL,
  "lead" TEXT,
  "bodyMarkdown" TEXT NOT NULL,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "footerVisible" BOOLEAN NOT NULL DEFAULT false,
  "footerLabel" TEXT,
  "footerColumn" "ContentFooterColumn",
  "footerOrder" INTEGER,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentPageRevision_pkey" PRIMARY KEY ("id")
);

INSERT INTO "ContentPageRevision" (
  "id",
  "pageId",
  "version",
  "eyebrow",
  "heroNote",
  "title",
  "lead",
  "bodyMarkdown",
  "seoTitle",
  "seoDescription",
  "footerVisible",
  "footerLabel",
  "footerColumn",
  "footerOrder",
  "createdAt"
)
SELECT
  "id" || '-revision-1',
  "id",
  1,
  "eyebrow",
  "heroNote",
  "title",
  "lead",
  "bodyMarkdown",
  "seoTitle",
  "seoDescription",
  "footerVisible",
  "footerLabel",
  "footerColumn",
  "footerOrder",
  "updatedAt"
FROM "ContentPage";

UPDATE "ContentPage"
SET
  "draftRevisionId" = "id" || '-revision-1',
  "publishedRevisionId" = CASE
    WHEN "published" AND "kind" = 'SYSTEM' THEN "id" || '-revision-1'
    ELSE NULL
  END,
  "published" = "published" AND "kind" = 'SYSTEM';

CREATE UNIQUE INDEX "ContentPage_systemKey_key" ON "ContentPage"("systemKey");
CREATE UNIQUE INDEX "ContentPage_draftRevisionId_key" ON "ContentPage"("draftRevisionId");
CREATE UNIQUE INDEX "ContentPage_publishedRevisionId_key" ON "ContentPage"("publishedRevisionId");
CREATE INDEX "ContentPage_kind_archivedAt_idx" ON "ContentPage"("kind", "archivedAt");
CREATE INDEX "ContentPage_footerVisible_footerColumn_footerOrder_idx"
  ON "ContentPage"("footerVisible", "footerColumn", "footerOrder");

CREATE UNIQUE INDEX "ContentPageRevision_pageId_version_key"
  ON "ContentPageRevision"("pageId", "version");
CREATE INDEX "ContentPageRevision_pageId_createdAt_idx"
  ON "ContentPageRevision"("pageId", "createdAt");
CREATE INDEX "ContentPageRevision_createdById_createdAt_idx"
  ON "ContentPageRevision"("createdById", "createdAt");

ALTER TABLE "ContentPageRevision"
  ADD CONSTRAINT "ContentPageRevision_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "ContentPage"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentPageRevision"
  ADD CONSTRAINT "ContentPageRevision_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentPage"
  ADD CONSTRAINT "ContentPage_draftRevisionId_fkey"
  FOREIGN KEY ("draftRevisionId") REFERENCES "ContentPageRevision"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentPage"
  ADD CONSTRAINT "ContentPage_publishedRevisionId_fkey"
  FOREIGN KEY ("publishedRevisionId") REFERENCES "ContentPageRevision"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
