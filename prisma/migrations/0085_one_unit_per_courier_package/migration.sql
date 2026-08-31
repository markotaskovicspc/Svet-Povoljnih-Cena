-- Courier operations use one label/package per sold unit. `Product.packQty`
-- remains warehouse transport-packaging metadata and must not merge units in
-- pickup batches that were created before this rule was corrected. Booked
-- batches are aligned only when the saved provider tracking data proves that
-- the courier already has exactly the required number of labels.
WITH line_counts AS (
  SELECT
    line."batchId",
    line."lineGroupKey",
    line."orderId",
    line."orderItemId",
    batch."provider",
    batch."status" AS batch_status,
    batch."labelsCreationStartedAt",
    batch."labelsCreatedAt",
    MAX(COALESCE(line."quantity", item."qty", 1))::INTEGER AS target_count,
    COUNT(*)::INTEGER AS current_count
  FROM "PickupBatchLine" AS line
  JOIN "PickupBatch" AS batch ON batch."id" = line."batchId"
  LEFT JOIN "OrderItem" AS item ON item."id" = line."orderItemId"
  WHERE line."purpose" = 'ORDER_DELIVERY'
    AND line."orderItemId" IS NOT NULL
  GROUP BY
    line."batchId",
    line."lineGroupKey",
    line."orderId",
    line."orderItemId",
    batch."provider",
    batch."status",
    batch."labelsCreationStartedAt",
    batch."labelsCreatedAt"
),
group_totals AS (
  SELECT
    "batchId",
    "lineGroupKey",
    MIN("orderId") AS "orderId",
    MIN("provider") AS "provider",
    MIN(batch_status::TEXT) AS batch_status,
    MIN("labelsCreationStartedAt") AS "labelsCreationStartedAt",
    MIN("labelsCreatedAt") AS "labelsCreatedAt",
    SUM(target_count)::INTEGER AS target_count
  FROM line_counts
  GROUP BY "batchId", "lineGroupKey"
  HAVING SUM(target_count) <= 99
     AND COUNT(DISTINCT "orderId") = 1
),
safe_groups AS (
  SELECT totals."batchId", totals."lineGroupKey"
  FROM group_totals AS totals
  WHERE (
    totals.batch_status = 'DRAFT'
    AND totals."labelsCreationStartedAt" IS NULL
    AND totals."labelsCreatedAt" IS NULL
  ) OR (
    totals.batch_status = 'BOOKED'
    AND totals."labelsCreatedAt" IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM "Shipment" AS shipment
      WHERE shipment."orderId" = totals."orderId"
        AND shipment."purpose" = 'ORDER_DELIVERY'
        AND shipment."provider" = totals."provider"
        AND shipment."status" <> 'FAILED'
        AND shipment."providerShipmentId" IS NOT NULL
        AND shipment."packageCount" = totals.target_count
        AND JSONB_TYPEOF(shipment."providerParcelNumbers") = 'array'
        AND JSONB_ARRAY_LENGTH(
          CASE
            WHEN JSONB_TYPEOF(shipment."providerParcelNumbers") = 'array'
              THEN shipment."providerParcelNumbers"
            ELSE '[]'::JSONB
          END
        ) = totals.target_count
    )
  )
),
deficient_items AS (
  SELECT counted.*
  FROM line_counts AS counted
  JOIN safe_groups AS safe
    ON safe."batchId" = counted."batchId"
   AND safe."lineGroupKey" = counted."lineGroupKey"
  WHERE counted.target_count > counted.current_count
),
template_lines AS (
  SELECT DISTINCT ON (line."batchId", line."lineGroupKey", line."orderItemId")
    line.*
  FROM "PickupBatchLine" AS line
  JOIN deficient_items AS deficient
    ON deficient."batchId" = line."batchId"
   AND deficient."lineGroupKey" = line."lineGroupKey"
   AND deficient."orderItemId" = line."orderItemId"
  ORDER BY
    line."batchId",
    line."lineGroupKey",
    line."orderItemId",
    line."packageNo",
    line."id"
),
group_maximums AS (
  SELECT "batchId", "lineGroupKey", MAX("packageNo") AS max_package_no
  FROM "PickupBatchLine"
  GROUP BY "batchId", "lineGroupKey"
),
missing_lines AS (
  SELECT
    deficient."batchId",
    deficient."lineGroupKey",
    deficient."orderItemId",
    deficient.target_count,
    generated.ordinal,
    ROW_NUMBER() OVER (
      PARTITION BY deficient."batchId", deficient."lineGroupKey"
      ORDER BY deficient."orderItemId", generated.ordinal
    )::INTEGER AS group_offset
  FROM deficient_items AS deficient
  CROSS JOIN LATERAL generate_series(
    1,
    deficient.target_count - deficient.current_count
  ) AS generated(ordinal)
)
INSERT INTO "PickupBatchLine" (
  "id",
  "batchId",
  "orderId",
  "orderItemId",
  "reclamationId",
  "purpose",
  "lineGroupKey",
  "quantity",
  "packageNo",
  "weightKg",
  "widthCm",
  "depthCm",
  "heightCm",
  "courierPickedUpAt",
  "courierPickedUpById"
)
SELECT
  'pkgfix_' || SUBSTRING(
    MD5(
      missing."batchId" || ':' || missing."lineGroupKey" || ':' ||
      missing."orderItemId" || ':' || missing.ordinal::TEXT
    ),
    1,
    24
  ),
  template."batchId",
  template."orderId",
  template."orderItemId",
  template."reclamationId",
  template."purpose",
  template."lineGroupKey",
  missing.target_count,
  maximum.max_package_no + missing.group_offset,
  template."weightKg",
  template."widthCm",
  template."depthCm",
  template."heightCm",
  NULL,
  NULL
FROM missing_lines AS missing
JOIN template_lines AS template
  ON template."batchId" = missing."batchId"
 AND template."lineGroupKey" = missing."lineGroupKey"
 AND template."orderItemId" = missing."orderItemId"
JOIN group_maximums AS maximum
  ON maximum."batchId" = missing."batchId"
 AND maximum."lineGroupKey" = missing."lineGroupKey";
