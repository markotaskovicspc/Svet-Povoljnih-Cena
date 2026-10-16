-- Restore only the missing quantities for SPC-2026-001088 from its saved
-- PRE-2026-0050 packing: five identical boxes, two units of SKU 110087 each.
-- No stock receipt, refund, courier submission, or status change is performed.
-- Existing parcel order is preserved to keep per-unit receipt keys stable.
WITH evidence AS (
  SELECT s.id, s."rawCreateResponse" AS before,
    jsonb_set(s."rawCreateResponse", '{articleLabels}',
      (SELECT jsonb_agg(label || jsonb_build_object('packedQuantity', 2) ORDER BY ordinal)
       FROM jsonb_array_elements(s."rawCreateResponse"->'articleLabels') WITH ORDINALITY AS x(label, ordinal))) AS after
  FROM "Shipment" s
  WHERE s.id = 'cb756a69-a4bc-4b5c-9e02-16d4217d09c1'
    AND s."orderId" = 'cmukt1qrx000304l5o6xfe5vu'
    AND s.provider = 'X_EXPRESS'
    AND s."providerParcelNumbers" = '["AAA0850301420","AAA0850301421","AAA0850301422","AAA0850301423","AAA0850301424"]'::jsonb
    AND jsonb_array_length(s."rawCreateResponse"->'articleLabels') = 5
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(s."rawCreateResponse"->'articleLabels') x
      WHERE x->>'sku' IS DISTINCT FROM '110087' OR x ? 'packedQuantity'
        OR NOT (s."providerParcelNumbers" @> jsonb_build_array(x->>'Code')))
    AND (SELECT count(DISTINCT x->>'Code') FROM jsonb_array_elements(s."rawCreateResponse"->'articleLabels') x) = 5
    AND (SELECT count(*) FROM "PickupBatchLine" l WHERE l."orderId"=s."orderId") = 5
    AND (SELECT count(*) FROM "PickupBatchLine" l JOIN "PickupBatch" b ON b.id=l."batchId"
      WHERE l."orderId"=s."orderId" AND b.number='PRE-2026-0050' AND b.status='PICKED_UP'
        AND l."orderItemId"='cmukt1qsz000404l53reihbto' AND l."packedQuantity"=2 AND l."deferredAt" IS NULL) = 5
), repaired AS (
  UPDATE "Shipment" s SET "rawCreateResponse"=e.after, "updatedAt"=now()
  FROM evidence e WHERE s.id=e.id AND s."rawCreateResponse"=e.before
  RETURNING s.id, e.before->'articleLabels' AS before, e.after->'articleLabels' AS after
), audited AS (
  INSERT INTO "AuditLog" (id,action,entity,"entityId",diff)
  SELECT gen_random_uuid()::text,'return-packing.restore-saved-quantities','Shipment',id,
    jsonb_build_object('sourceBatch','PRE-2026-0050','reason','Legacy labels omitted quantities; all five saved packing rows contain two units of the same item','before',before,'after',after)
  FROM repaired RETURNING "entityId"
)
SELECT "entityId" AS repaired_shipment FROM audited;
