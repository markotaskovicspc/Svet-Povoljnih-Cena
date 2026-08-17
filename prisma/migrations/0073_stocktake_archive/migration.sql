ALTER TABLE "DispatchNote"
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "DispatchNote_type_archivedAt_createdAt_idx"
ON "DispatchNote"("type", "archivedAt", "createdAt");
