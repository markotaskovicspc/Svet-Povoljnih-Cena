CREATE TABLE "ReturnParcelArrival" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "parcelNumber" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReturnParcelArrival_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReturnParcelArrival_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReturnParcelArrival_shipmentId_parcelNumber_key" ON "ReturnParcelArrival"("shipmentId", "parcelNumber");
ALTER TABLE "ReturnParcelArrival" ENABLE ROW LEVEL SECURITY;
