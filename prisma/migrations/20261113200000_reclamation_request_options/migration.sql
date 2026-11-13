-- Novi izbori rešenja u formi reklamacije (Marko, 13.11.2026). POPRAVKA ostaje za stare prijave.
ALTER TYPE "ReclamationRequest" ADD VALUE IF NOT EXISTS 'ZAMENA_DELA';
ALTER TYPE "ReclamationRequest" ADD VALUE IF NOT EXISTS 'ODUSTANAK';
