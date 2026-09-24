CREATE TABLE "GuestLoyaltyMembership" (
  "email" TEXT NOT NULL PRIMARY KEY,
  "consentVersion" TEXT NOT NULL,
  "consentAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "GuestLoyaltyMembership" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Order" ADD COLUMN "guestLoyaltyEmail" TEXT;
ALTER TABLE "Order" ADD COLUMN "guestLoyaltyConsentVersion" TEXT;
