-- Ručno odobrenje uplate povrata bez vraćene robe (Marko, 13.11.2026).
ALTER TABLE "Reclamation" ADD COLUMN "refundWithoutReturnAt" TIMESTAMP(3);
ALTER TABLE "Reclamation" ADD COLUMN "refundWithoutReturnById" TEXT;
