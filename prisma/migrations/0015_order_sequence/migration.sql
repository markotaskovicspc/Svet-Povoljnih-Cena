CREATE TABLE "OrderSequence" (
  "year" INTEGER NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderSequence_pkey" PRIMARY KEY ("year")
);

INSERT INTO "OrderSequence" ("year", "lastValue", "updatedAt")
SELECT
  CAST(substring(number from '^SPC-([0-9]{4})-') AS INTEGER) AS "year",
  MAX(CAST(substring(number from '^SPC-[0-9]{4}-([0-9]+)$') AS INTEGER)) AS "lastValue",
  CURRENT_TIMESTAMP AS "updatedAt"
FROM "Order"
WHERE number ~ '^SPC-[0-9]{4}-[0-9]+$'
GROUP BY 1
ON CONFLICT ("year") DO UPDATE
SET
  "lastValue" = GREATEST("OrderSequence"."lastValue", EXCLUDED."lastValue"),
  "updatedAt" = CURRENT_TIMESTAMP;
