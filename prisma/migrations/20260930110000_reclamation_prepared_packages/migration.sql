ALTER TABLE "Reclamation"
  ADD COLUMN "replacementPackages" JSONB,
  ADD COLUMN "replacementReadyAt" TIMESTAMP(3),
  ADD COLUMN "replacementReadyById" TEXT;
