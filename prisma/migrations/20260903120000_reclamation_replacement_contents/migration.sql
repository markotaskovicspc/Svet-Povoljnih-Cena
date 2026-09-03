-- Keep the legally claimed product quantity separate from what the warehouse
-- actually sends. A spare-part resolution represents zero complete articles.
ALTER TABLE "Reclamation"
  ADD COLUMN "replacementQty" INTEGER;

UPDATE "Reclamation"
SET "replacementQty" = CASE
  WHEN "resolution" = 'ZAMENA_DELA' THEN 0
  WHEN "resolution" = 'ZAMENA_ARTIKLA' THEN "quantity"
  ELSE NULL
END;

ALTER TABLE "Reclamation"
  ADD CONSTRAINT "Reclamation_replacementQty_check"
  CHECK (
    "replacementQty" IS NULL
    OR ("replacementQty" >= 0 AND "replacementQty" <= "quantity")
  );

-- Existing unposted spare-part rows inherited the full article quantity and
-- dimensions. Correct the quantity and require the operator to enter the
-- actual parcel measurements before a courier label can be created.
UPDATE "PickupBatchLine" AS line
SET
  "quantity" = 0,
  "weightKg" = NULL,
  "widthCm" = NULL,
  "depthCm" = NULL,
  "heightCm" = NULL
FROM "Reclamation" AS reclamation, "PickupBatch" AS batch
WHERE line."reclamationId" = reclamation."id"
  AND line."batchId" = batch."id"
  AND line."purpose" = 'RECLAMATION_REPLACEMENT'
  AND reclamation."resolution" = 'ZAMENA_DELA'
  AND batch."status" = 'DRAFT'
  AND batch."labelsCreatedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "Shipment" AS shipment
    WHERE shipment."reclamationId" = reclamation."id"
      AND shipment."purpose" = 'RECLAMATION_REPLACEMENT'
      AND shipment."status" <> 'FAILED'
  );
