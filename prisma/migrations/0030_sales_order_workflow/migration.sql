-- Complete manual VP/INO sales-order numbering and SEF acceptance tracking.
ALTER TABLE "Order"
ADD COLUMN "sefAcceptedAt" TIMESTAMP(3);

CREATE TABLE "SalesOrderSequence" (
    "channel" "SalesChannel" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrderSequence_pkey" PRIMARY KEY ("channel", "year")
);
