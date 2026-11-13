-- Posebna polja u formi reklamacije: broj računa i procenat umanjenja (Marko, 13.11.2026).
ALTER TABLE "Reclamation" ADD COLUMN "refundAccount" VARCHAR(40);
ALTER TABLE "Reclamation" ADD COLUMN "requestedDiscountPct" INTEGER;
