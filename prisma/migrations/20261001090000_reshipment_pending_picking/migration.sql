-- A reshipment waits for explicit loading before it belongs to a picking batch.
ALTER TABLE "OrderReshipment" ALTER COLUMN "batchId" DROP NOT NULL;
