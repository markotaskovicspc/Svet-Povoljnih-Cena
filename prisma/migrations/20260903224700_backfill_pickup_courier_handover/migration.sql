-- Pickup handover reconciliation was added after some X Express events had
-- already reached terminal states. Those events correctly advanced Shipment
-- and Order, but the corresponding picking rows retained a null handover
-- marker and continued to display "Čeka status kurira".
--
-- Shipment.shippedAt is the preserved timestamp of the first provider-confirmed
-- pickup event. Match the same provider, purpose, reclamation and (when saved)
-- order-item assignment used by the runtime reconciler.
WITH ranked_handover_proofs AS (
  SELECT
    line."id" AS line_id,
    shipment."shippedAt" AS picked_up_at,
    ROW_NUMBER() OVER (
      PARTITION BY line."id"
      ORDER BY
        shipment."updatedAt" DESC,
        shipment."createdAt" DESC,
        shipment."id" DESC
    ) AS proof_rank
  FROM "PickupBatchLine" AS line
  JOIN "PickupBatch" AS batch
    ON batch."id" = line."batchId"
  JOIN "Shipment" AS shipment
    ON shipment."orderId" = line."orderId"
   AND shipment."provider" = batch."provider"
   AND shipment."purpose" = line."purpose"
   AND (
     line."purpose" = 'ORDER_DELIVERY'
     OR shipment."reclamationId" = line."reclamationId"
   )
  WHERE line."courierPickedUpAt" IS NULL
    AND shipment."shippedAt" IS NOT NULL
    AND (
      line."purpose" <> 'ORDER_DELIVERY'
      OR JSONB_TYPEOF(
        shipment."rawCreateResponse" #> '{assignment,orderItemIds}'
      ) IS DISTINCT FROM 'array'
      OR line."orderItemId" IS NULL
      OR (shipment."rawCreateResponse" #> '{assignment,orderItemIds}') ? line."orderItemId"
    )
), selected_handover_proofs AS (
  SELECT line_id, picked_up_at
  FROM ranked_handover_proofs
  WHERE proof_rank = 1
)
UPDATE "PickupBatchLine" AS line
SET
  "courierPickedUpAt" = proof.picked_up_at,
  "courierPickedUpById" = NULL
FROM selected_handover_proofs AS proof
WHERE line."id" = proof.line_id;

-- A batch is fully picked up only when every physical package has proof.
UPDATE "PickupBatch" AS batch
SET
  "status" = 'PICKED_UP',
  "updatedAt" = NOW()
WHERE batch."status" = 'BOOKED'
  AND EXISTS (
    SELECT 1
    FROM "PickupBatchLine" AS line
    WHERE line."batchId" = batch."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "PickupBatchLine" AS line
    WHERE line."batchId" = batch."id"
      AND line."courierPickedUpAt" IS NULL
  );
