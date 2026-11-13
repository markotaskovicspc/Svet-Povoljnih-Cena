-- Kolona „SPC Analytics“ u dnevniku reklamacija (Marko, 13.11.2026).
ALTER TABLE "Reclamation" ADD COLUMN "analyticsStatus" VARCHAR(80);
ALTER TABLE "Reclamation" ADD COLUMN "analyticsStatusNote" VARCHAR(240);
ALTER TABLE "Reclamation" ADD COLUMN "analyticsStatusAt" TIMESTAMP(3);
