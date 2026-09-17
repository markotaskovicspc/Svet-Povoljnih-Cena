ALTER TABLE "Address"
ADD COLUMN "houseNumber" TEXT;

ALTER TABLE "Order"
ADD COLUMN "shipHouseNumber" TEXT,
ADD COLUMN "billHouseNumber" TEXT;
