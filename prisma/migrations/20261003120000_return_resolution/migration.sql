CREATE TABLE "ReturnResolution" (
  "key" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReturnResolution_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "ReturnResolution_orderId_idx" ON "ReturnResolution"("orderId");
ALTER TABLE "ReturnResolution" ENABLE ROW LEVEL SECURITY;
