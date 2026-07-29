-- Full newsletter campaign center: canonical contacts/consent evidence,
-- reusable audiences/templates, immutable versions and recipient delivery state.

CREATE TYPE "MarketingContactStatus" AS ENUM ('PENDING', 'ACTIVE', 'UNSUBSCRIBED', 'SUPPRESSED');
CREATE TYPE "MarketingConsentEventType" AS ENUM ('REQUESTED', 'CONFIRMED', 'GRANTED', 'WITHDRAWN', 'SUPPRESSED', 'RESTORED', 'MIGRATED');
CREATE TYPE "NewsletterAudienceMode" AS ENUM ('DYNAMIC', 'FIXED');
CREATE TYPE "NewsletterCampaignStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PREPARING', 'SENDING', 'SENT', 'CANCELLED', 'PARTIAL_FAILED', 'FAILED');
CREATE TYPE "NewsletterRecipientStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'UNSUBSCRIBED');

CREATE TABLE "MarketingContact" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "userId" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "language" TEXT NOT NULL DEFAULT 'sr-Latn',
  "status" "MarketingContactStatus" NOT NULL DEFAULT 'PENDING',
  "source" TEXT,
  "consentVersion" TEXT,
  "subscribedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3),
  "suppressedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketingContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingConsentEvent" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "type" "MarketingConsentEventType" NOT NULL,
  "source" TEXT NOT NULL,
  "consentVersion" TEXT,
  "policyVersion" TEXT,
  "actorId" TEXT,
  "evidence" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingConsentEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsletterOptInToken" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsletterOptInToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsletterAudience" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "filter" JSONB NOT NULL,
  "estimatedCount" INTEGER,
  "estimatedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterAudience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsletterTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT,
  "previewText" TEXT,
  "content" JSONB NOT NULL,
  "html" TEXT,
  "text" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "NewsletterCampaign" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "NewsletterCampaign"
  ALTER COLUMN "status" TYPE "NewsletterCampaignStatus"
  USING ("status"::text::"NewsletterCampaignStatus");
ALTER TABLE "NewsletterCampaign" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "NewsletterCampaign"
  ADD COLUMN "previewText" TEXT,
  ADD COLUMN "content" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "html" TEXT,
  ADD COLUMN "text" TEXT,
  ADD COLUMN "fromName" TEXT,
  ADD COLUMN "fromEmail" TEXT,
  ADD COLUMN "replyTo" TEXT,
  ADD COLUMN "audienceId" TEXT,
  ADD COLUMN "audienceMode" "NewsletterAudienceMode" NOT NULL DEFAULT 'DYNAMIC',
  ADD COLUMN "audienceFilterSnapshot" JSONB,
  ADD COLUMN "audienceBreakdown" JSONB,
  ADD COLUMN "topicKey" TEXT NOT NULL DEFAULT 'promotions',
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "providerBroadcastId" TEXT,
  ADD COLUMN "providerSegmentId" TEXT,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "opened" INTEGER,
  ADD COLUMN "clicked" INTEGER,
  ADD COLUMN "bounced" INTEGER,
  ADD COLUMN "complained" INTEGER,
  ADD COLUMN "unsubscribed" INTEGER,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "updatedById" TEXT;

CREATE TABLE "NewsletterCampaignVersion" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "subject" TEXT NOT NULL,
  "previewText" TEXT,
  "content" JSONB NOT NULL,
  "html" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "audienceFilter" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsletterCampaignVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NewsletterCampaignRecipient" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "contactId" TEXT,
  "email" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "language" TEXT NOT NULL DEFAULT 'sr-Latn',
  "status" "NewsletterRecipientStatus" NOT NULL DEFAULT 'QUEUED',
  "providerMessageId" TEXT,
  "failureReason" TEXT,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  "bouncedAt" TIMESTAMP(3),
  "complainedAt" TIMESTAMP(3),
  "unsubscribedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NewsletterCampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingContact_email_key" ON "MarketingContact"("email");
CREATE UNIQUE INDEX "MarketingContact_userId_key" ON "MarketingContact"("userId");
CREATE INDEX "MarketingContact_status_subscribedAt_idx" ON "MarketingContact"("status", "subscribedAt");
CREATE INDEX "MarketingContact_source_createdAt_idx" ON "MarketingContact"("source", "createdAt");
CREATE INDEX "MarketingConsentEvent_contactId_occurredAt_idx" ON "MarketingConsentEvent"("contactId", "occurredAt");
CREATE INDEX "MarketingConsentEvent_type_occurredAt_idx" ON "MarketingConsentEvent"("type", "occurredAt");
CREATE UNIQUE INDEX "NewsletterOptInToken_tokenHash_key" ON "NewsletterOptInToken"("tokenHash");
CREATE INDEX "NewsletterOptInToken_contactId_expiresAt_idx" ON "NewsletterOptInToken"("contactId", "expiresAt");
CREATE INDEX "NewsletterOptInToken_expiresAt_usedAt_idx" ON "NewsletterOptInToken"("expiresAt", "usedAt");
CREATE UNIQUE INDEX "NewsletterAudience_name_key" ON "NewsletterAudience"("name");
CREATE INDEX "NewsletterAudience_updatedAt_idx" ON "NewsletterAudience"("updatedAt");
CREATE UNIQUE INDEX "NewsletterTemplate_name_key" ON "NewsletterTemplate"("name");
CREATE INDEX "NewsletterTemplate_updatedAt_idx" ON "NewsletterTemplate"("updatedAt");
CREATE UNIQUE INDEX "NewsletterCampaign_providerBroadcastId_key" ON "NewsletterCampaign"("providerBroadcastId");
CREATE INDEX "NewsletterCampaign_audienceId_createdAt_idx" ON "NewsletterCampaign"("audienceId", "createdAt");
CREATE INDEX "NewsletterCampaign_providerBroadcastId_idx" ON "NewsletterCampaign"("providerBroadcastId");
CREATE UNIQUE INDEX "NewsletterCampaignVersion_campaignId_version_key" ON "NewsletterCampaignVersion"("campaignId", "version");
CREATE INDEX "NewsletterCampaignVersion_campaignId_createdAt_idx" ON "NewsletterCampaignVersion"("campaignId", "createdAt");
CREATE UNIQUE INDEX "NewsletterCampaignRecipient_providerMessageId_key" ON "NewsletterCampaignRecipient"("providerMessageId");
CREATE UNIQUE INDEX "NewsletterCampaignRecipient_campaignId_email_key" ON "NewsletterCampaignRecipient"("campaignId", "email");
CREATE INDEX "NewsletterCampaignRecipient_campaignId_status_idx" ON "NewsletterCampaignRecipient"("campaignId", "status");
CREATE INDEX "NewsletterCampaignRecipient_contactId_createdAt_idx" ON "NewsletterCampaignRecipient"("contactId", "createdAt");
CREATE INDEX "NewsletterCampaignRecipient_email_createdAt_idx" ON "NewsletterCampaignRecipient"("email", "createdAt");

ALTER TABLE "MarketingContact" ADD CONSTRAINT "MarketingContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketingConsentEvent" ADD CONSTRAINT "MarketingConsentEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "MarketingContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsletterOptInToken" ADD CONSTRAINT "NewsletterOptInToken_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "MarketingContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsletterCampaign" ADD CONSTRAINT "NewsletterCampaign_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "NewsletterAudience"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NewsletterCampaignVersion" ADD CONSTRAINT "NewsletterCampaignVersion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NewsletterCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsletterCampaignRecipient" ADD CONSTRAINT "NewsletterCampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NewsletterCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsletterCampaignRecipient" ADD CONSTRAINT "NewsletterCampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "MarketingContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill canonical contacts. Legacy newsletter opt-out wins over an account
-- flag for the same normalized email. Order/customer addresses are never used.
INSERT INTO "MarketingContact" (
  "id", "email", "status", "source", "consentVersion", "subscribedAt",
  "confirmedAt", "unsubscribedAt", "createdAt", "updatedAt"
)
SELECT
  'mc_' || md5(random()::text || clock_timestamp()::text || lower(trim(ns."email"))),
  lower(trim(ns."email")),
  CASE WHEN ns."consent" = true AND ns."unsubscribedAt" IS NULL
    THEN 'ACTIVE'::"MarketingContactStatus"
    ELSE 'UNSUBSCRIBED'::"MarketingContactStatus" END,
  COALESCE(ns."source", 'legacy-newsletter'),
  'legacy-v1',
  ns."createdAt",
  ns."createdAt",
  ns."unsubscribedAt",
  ns."createdAt",
  CURRENT_TIMESTAMP
FROM "NewsletterSubscriber" ns
WHERE trim(ns."email") <> ''
ON CONFLICT ("email") DO NOTHING;

INSERT INTO "MarketingContact" (
  "id", "email", "userId", "firstName", "lastName", "language", "status",
  "source", "consentVersion", "subscribedAt", "confirmedAt", "createdAt", "updatedAt"
)
SELECT
  'mc_' || md5(random()::text || clock_timestamp()::text || lower(trim(u."email"))),
  lower(trim(u."email")),
  u."id", u."firstName", u."lastName", u."language",
  'ACTIVE'::"MarketingContactStatus", 'legacy-account', 'legacy-v1',
  mc."updatedAt", COALESCE(u."emailVerified", mc."updatedAt"), u."createdAt", CURRENT_TIMESTAMP
FROM "User" u
JOIN "MarketingConsent" mc ON mc."userId" = u."id" AND mc."email" = true
WHERE u."email" IS NOT NULL AND u."deletedAt" IS NULL AND trim(u."email") <> ''
ON CONFLICT ("email") DO UPDATE SET
  "userId" = EXCLUDED."userId",
  "firstName" = COALESCE("MarketingContact"."firstName", EXCLUDED."firstName"),
  "lastName" = COALESCE("MarketingContact"."lastName", EXCLUDED."lastName"),
  "language" = EXCLUDED."language",
  "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "MarketingContact" contact
SET "status" = 'SUPPRESSED', "suppressedAt" = suppression."createdAt", "updatedAt" = CURRENT_TIMESTAMP
FROM "EmailSuppression" suppression
WHERE lower(trim(suppression."email")) = contact."email";

INSERT INTO "MarketingConsentEvent" (
  "id", "contactId", "type", "source", "consentVersion", "evidence", "occurredAt"
)
SELECT
  'mce_' || md5(random()::text || clock_timestamp()::text || contact."id"),
  contact."id", 'MIGRATED', COALESCE(contact."source", 'legacy'), contact."consentVersion",
  jsonb_build_object('legacyStatus', contact."status"::text),
  COALESCE(contact."subscribedAt", contact."createdAt")
FROM "MarketingContact" contact;
