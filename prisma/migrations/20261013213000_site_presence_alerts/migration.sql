ALTER TABLE "AdminPushSubscription" ADD COLUMN "trafficAlerts" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "SiteVisitorPresence" (
  "anonymousId" VARCHAR(96) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteVisitorPresence_pkey" PRIMARY KEY ("anonymousId")
);
CREATE INDEX "SiteVisitorPresence_lastSeenAt_idx" ON "SiteVisitorPresence"("lastSeenAt");
ALTER TABLE "SiteVisitorPresence" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SiteVisitorPresence" FROM anon, authenticated;
