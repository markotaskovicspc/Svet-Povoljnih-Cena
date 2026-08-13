-- A purchase order may be referenced by only one inbound invoice. Historical
-- cancelled duplicates did not participate in COGS or receiving, so detach
-- only those duplicate links before installing the database invariant. Active
-- duplicates are intentionally left in place and make the migration fail for
-- manual review instead of silently choosing between operational documents.
WITH ranked_links AS (
  SELECT
    "id",
    "status",
    ROW_NUMBER() OVER (
      PARTITION BY "purchaseOrderId"
      ORDER BY
        CASE WHEN "status" = 'CANCELLED' THEN 1 ELSE 0 END,
        CASE WHEN "lockedAt" IS NOT NULL THEN 0 ELSE 1 END,
        "createdAt" ASC,
        "id" ASC
    ) AS position
  FROM "InboundInvoice"
  WHERE "purchaseOrderId" IS NOT NULL
)
UPDATE "InboundInvoice" AS invoice
SET "purchaseOrderId" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked_links
WHERE invoice."id" = ranked_links."id"
  AND ranked_links.position > 1
  AND ranked_links."status" = 'CANCELLED';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "InboundInvoice"
    WHERE "purchaseOrderId" IS NOT NULL
    GROUP BY "purchaseOrderId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Više aktivnih ulaznih faktura je povezano sa istom porudžbenicom.',
      DETAIL = 'Razrešite postojeće duple veze pre ponovnog pokretanja migracije.';
  END IF;
END $$;

DROP INDEX "InboundInvoice_purchaseOrderId_idx";

CREATE UNIQUE INDEX "InboundInvoice_purchaseOrderId_key"
  ON "InboundInvoice"("purchaseOrderId");
