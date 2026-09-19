-- Additive, no contact backfill; old deployments ignore these structures.
ALTER TABLE "MarketingContact" ADD COLUMN "customFields" JSONB;
CREATE TABLE "NewsletterContactImport" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "listName" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "consentEvidence" TEXT,
  "totalContacts" INTEGER NOT NULL,
  "nextBatch" INTEGER NOT NULL DEFAULT 0,
  "importedCount" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterContactImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NewsletterContactImport_totalContacts_check" CHECK ("totalContacts" BETWEEN 1 AND 100000)
);
CREATE INDEX "NewsletterContactImport_actorId_createdAt_idx" ON "NewsletterContactImport"("actorId", "createdAt");
ALTER TABLE "NewsletterContactImport" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "NewsletterContactImport" FROM anon, authenticated;
