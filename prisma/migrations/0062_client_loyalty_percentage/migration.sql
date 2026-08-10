UPDATE "LoyaltyRule"
SET "discountPct" = 30,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "active" = true
  AND "discountPct" <> 30;
