CREATE TABLE "AdminPushSubscription" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "endpoint" VARCHAR(2048) NOT NULL,
  "p256dh" VARCHAR(100) NOT NULL,
  "auth" VARCHAR(40) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminPushSubscription_endpoint_key" ON "AdminPushSubscription"("endpoint");
CREATE INDEX "AdminPushSubscription_adminUserId_idx" ON "AdminPushSubscription"("adminUserId");
ALTER TABLE "AdminPushSubscription" ADD CONSTRAINT "AdminPushSubscription_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminPushSubscription" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AdminPushSubscription" FROM anon, authenticated;
