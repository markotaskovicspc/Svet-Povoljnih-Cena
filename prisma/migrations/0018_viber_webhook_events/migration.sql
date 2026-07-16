-- Persist Viber delivery callbacks so provider retries cannot update campaign
-- counters more than once.

CREATE TABLE "ViberWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "messageToken" TEXT,
  "campaignId" TEXT,
  "recipientUserId" TEXT,
  "payload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3),

  CONSTRAINT "ViberWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ViberWebhookEvent_eventId_key"
  ON "ViberWebhookEvent"("eventId");
CREATE INDEX "ViberWebhookEvent_campaignId_receivedAt_idx"
  ON "ViberWebhookEvent"("campaignId", "receivedAt");
CREATE INDEX "ViberWebhookEvent_event_receivedAt_idx"
  ON "ViberWebhookEvent"("event", "receivedAt");
