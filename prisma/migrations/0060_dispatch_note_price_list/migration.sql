ALTER TABLE "DispatchNote" ADD COLUMN "priceListId" TEXT;

CREATE INDEX "DispatchNote_priceListId_idx" ON "DispatchNote"("priceListId");

ALTER TABLE "DispatchNote"
ADD CONSTRAINT "DispatchNote_priceListId_fkey"
FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
