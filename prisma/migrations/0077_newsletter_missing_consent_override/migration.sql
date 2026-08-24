-- Keep missing consent as an explicit, auditable campaign policy instead of
-- mutating imported contacts to look consented. Explicit opt-outs and
-- suppressions remain ineligible at resolution and immediately before send.
ALTER TABLE "NewsletterCampaign"
  ADD COLUMN "includeContactsWithoutConsent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "NewsletterCampaignVersion"
  ADD COLUMN "includeContactsWithoutConsent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "NewsletterCampaignRecipient"
  ADD COLUMN "consentStatusAtSelection" "MarketingContactStatus";
