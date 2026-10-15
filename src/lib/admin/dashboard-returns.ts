import { Prisma } from "@prisma/client";
import { resolveReportPeriod } from "./report-period";

export type DashboardReturnSummary = { sent: number; returned: number };

/** Sold units in the first-dispatch cohort, capped per original order line.
 * Parcel snapshots identify partial returns; stock receipts corroborate courier
 * evidence rather than adding the same goods a second time.
 */
export function dashboardReturnsQuery(now: Date, warehouseId: string) {
  const period = resolveReportPeriod({ range: "30d" }, now);
  const warehouse = warehouseId ? Prisma.sql`AND EXISTS (
    SELECT 1 FROM "OrderItem" i WHERE i."orderId" = o.id AND i."warehouseId" = ${warehouseId}
  )` : Prisma.empty;
  return Prisma.sql`(
    WITH dispatched AS (
      SELECT source."orderId", MIN(source.at) AS sent_at FROM (
        SELECT s."orderId", s."shippedAt" AS at FROM "Shipment" s
          WHERE s.purpose = 'ORDER_DELIVERY' AND s."shippedAt" IS NOT NULL
        UNION ALL
        SELECT s."orderId", e."occurredAt" FROM "ShipmentEvent" e
          JOIN "Shipment" s ON s.id = e."shipmentId"
          WHERE s.purpose = 'ORDER_DELIVERY' AND e.status = 'PICKED_UP'
        UNION ALL
        SELECT p."orderId", p."courierPickedUpAt" FROM "PickupBatchLine" p
          WHERE p.purpose = 'ORDER_DELIVERY' AND p."courierPickedUpAt" IS NOT NULL
        UNION ALL
        SELECT e."orderId", e."createdAt" FROM "OrderStatusEvent" e WHERE e.status = 'U_ISPORUCI'
      ) source GROUP BY source."orderId"
    ), cohort AS (
      SELECT o.* FROM dispatched d JOIN "Order" o ON o.id = d."orderId"
      WHERE d.sent_at >= ${period.start} AND d.sent_at < ${period.endExclusive}
        AND d.sent_at <= ${now} ${warehouse}
    ), items AS (
      SELECT i.* FROM "OrderItem" i JOIN cohort o ON o.id = i."orderId"
      WHERE i.qty > 0 ${warehouseId ? Prisma.sql`AND i."warehouseId" = ${warehouseId}` : Prisma.empty}
    ), shipments AS (
      SELECT s.*,
        EXISTS (SELECT 1 FROM "ReturnParcelArrival" a WHERE a."shipmentId" = s.id) AS has_arrivals,
        CASE WHEN s.purpose = 'RECLAMATION_RETURN' THEN
          s.status = 'DELIVERED' OR EXISTS (SELECT 1 FROM "ShipmentEvent" e WHERE e."shipmentId" = s.id AND e.status = 'DELIVERED')
        ELSE s.status = 'RETURNED' OR EXISTS (SELECT 1 FROM "ShipmentEvent" e WHERE e."shipmentId" = s.id AND e.status = 'RETURNED') END AS returned
      FROM "Shipment" s JOIN cohort o ON o.id = s."orderId"
      WHERE s.purpose IN ('ORDER_DELIVERY', 'RECLAMATION_RETURN', 'RECLAMATION_REPLACEMENT')
    ), parcel_contents AS (
      -- Immutable picking snapshots, including mixed-product parcels.
      SELECT p."shipmentId", p."providerParcelNumber" AS code,
        COALESCE(v->>'orderItemId', p."orderItemId") AS item_id,
        COALESCE((v->>'quantity')::int, p."packedQuantity") AS qty, 1 AS priority
      FROM "PickupBatchLine" p JOIN shipments s ON s.id = p."shipmentId"
      LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."packedItems") = 'array' THEN p."packedItems" ELSE '[]'::jsonb END) v ON true
      WHERE p."providerParcelNumber" IS NOT NULL
      UNION ALL
      -- Historical XExpress/MyGLS labels predate saved picking contents.
      SELECT s.id, COALESCE(v->>'parcelNumber', v->>'Code'),
        COALESCE(packed->>'orderItemId', v->>'orderItemId', i.id),
        COALESCE((packed->>'quantity')::int, (v->>'packedQuantity')::int,
          CASE WHEN s."packageCount" = 1 THEN i.qty END), 2
      FROM shipments s
      CROSS JOIN LATERAL jsonb_array_elements(CASE
        WHEN jsonb_typeof(s."rawCreateResponse"->'myGlsPackageAssignments') = 'array' THEN s."rawCreateResponse"->'myGlsPackageAssignments'
        WHEN jsonb_typeof(s."rawCreateResponse"->'articleLabels') = 'array' THEN s."rawCreateResponse"->'articleLabels'
        ELSE '[]'::jsonb END) v
      LEFT JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v->'packedItems') = 'array' THEN v->'packedItems' ELSE '[]'::jsonb END) packed ON true
      LEFT JOIN items i ON i."orderId" = s."orderId" AND i.sku = v->>'sku'
    ), normalized_contents AS (
      SELECT "shipmentId", UPPER(regexp_replace(regexp_replace(code, '[[:space:]]', '', 'g'), '^0+(?=[0-9])', '')) AS code,
        item_id, qty, priority FROM parcel_contents
    ), parcels AS (
      SELECT DISTINCT ON ("shipmentId", code, item_id) "shipmentId", code, item_id, qty
      FROM normalized_contents WHERE item_id IS NOT NULL AND code IS NOT NULL AND qty > 0
      ORDER BY "shipmentId", code, item_id, priority
    ), mapped_returns AS (
      SELECT s.id, p.item_id, SUM(p.qty)::int AS qty
      FROM shipments s JOIN parcels p ON p."shipmentId" = s.id
      WHERE (s.returned AND NOT s.has_arrivals) OR EXISTS (
        SELECT 1 FROM "ReturnParcelArrival" a WHERE a."shipmentId" = s.id
          AND UPPER(regexp_replace(regexp_replace(a."parcelNumber", '[[:space:]]', '', 'g'), '^0+(?=[0-9])', ''))
            = UPPER(regexp_replace(regexp_replace(p.code, '[[:space:]]', '', 'g'), '^0+(?=[0-9])', ''))
      ) GROUP BY s.id, p.item_id
    ), courier_returns AS (
      SELECT i.id AS item_id,
        CASE WHEN r.id IS NULL THEN 'order' ELSE 'claim:' || r.id END AS source,
        SUM(LEAST(i.qty, COALESCE(m.qty,
        CASE WHEN (s.returned OR s.has_arrivals) AND NOT EXISTS (SELECT 1 FROM parcels p WHERE p."shipmentId" = s.id)
          -- With no parcel contents, only a complete shipment is evidence of all units.
          AND (NOT s.has_arrivals OR s."packageCount" = 1 OR
            (SELECT COUNT(DISTINCT a."parcelNumber") FROM "ReturnParcelArrival" a WHERE a."shipmentId" = s.id) >= s."packageCount")
        THEN CASE WHEN r.id IS NOT NULL THEN
          CASE WHEN s.purpose = 'RECLAMATION_REPLACEMENT' THEN COALESCE(r."replacementQty", r.quantity) ELSE r.quantity END
          WHEN (SELECT COUNT(*) FROM shipments original WHERE original."orderId" = i."orderId" AND original.purpose = 'ORDER_DELIVERY') = 1 OR (SELECT SUM(oi.qty) FROM "OrderItem" oi WHERE oi."orderId" = i."orderId") = 1 THEN i.qty
          ELSE 0 END ELSE 0 END)))::int AS qty
      FROM items i JOIN shipments s ON s."orderId" = i."orderId"
      LEFT JOIN "Reclamation" r ON r.id = s."reclamationId"
      LEFT JOIN mapped_returns m ON m.id = s.id AND m.item_id = i.id
      WHERE r.id IS NULL OR r."orderItemId" = i.id OR (r."orderItemId" IS NULL AND r.sku = i.sku)
      GROUP BY i.id, CASE WHEN r.id IS NULL THEN 'order' ELSE 'claim:' || r.id END
    ), receipts AS (
      SELECT i.id AS item_id,
        CASE WHEN m."idempotencyKey" LIKE 'reclamation-return:%' THEN 'claim:' || split_part(m."idempotencyKey", ':', 2) ELSE 'order' END AS source,
        GREATEST(
          COALESCE(SUM(m.qty) FILTER (WHERE m.kind = 'REFUND_RETURN' AND m.qty > 0), 0),
          COUNT(*) FILTER (WHERE m."idempotencyKey" LIKE 'order-return:%')
        )::int AS qty
      FROM items i JOIN "StockMovement" m ON m."orderId" = i."orderId"
        AND (m."orderItemId" = i.id OR (m."orderItemId" IS NULL AND m.sku = i.sku))
      GROUP BY i.id, CASE WHEN m."idempotencyKey" LIKE 'reclamation-return:%' THEN 'claim:' || split_part(m."idempotencyKey", ':', 2) ELSE 'order' END
    ), returned_items AS (
      SELECT COALESCE(c.item_id, r.item_id) AS item_id,
        SUM(GREATEST(COALESCE(c.qty, 0), COALESCE(r.qty, 0))) AS qty
      FROM courier_returns c FULL JOIN receipts r ON r.item_id = c.item_id AND r.source = c.source
      GROUP BY COALESCE(c.item_id, r.item_id)
    ), sent_parcels AS (
      SELECT p.* FROM parcels p JOIN shipments s ON s.id = p."shipmentId"
      WHERE s.purpose = 'ORDER_DELIVERY' AND (s."shippedAt" <= ${now}
        OR EXISTS (SELECT 1 FROM "ShipmentEvent" e WHERE e."shipmentId" = s.id AND e.status = 'PICKED_UP' AND e."occurredAt" <= ${now})
        OR EXISTS (SELECT 1 FROM "PickupBatchLine" b WHERE b."shipmentId" = s.id AND b."courierPickedUpAt" <= ${now}))
    ), quantities AS (
      SELECT sent.qty AS sent, LEAST(sent.qty, GREATEST(COALESCE(r.qty, 0),
        CASE WHEN COALESCE(r.qty, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s."orderId" = i."orderId" AND (s.has_arrivals OR s.returned))
          AND (o.status = 'VRACENO' OR EXISTS (SELECT 1 FROM "OrderStatusEvent" e WHERE e."orderId" = o.id AND e.status = 'VRACENO'))
        THEN i.qty ELSE 0 END)) AS returned
      FROM items i JOIN cohort o ON o.id = i."orderId"
      LEFT JOIN returned_items r ON r.item_id = i.id
      CROSS JOIN LATERAL (SELECT LEAST(i.qty, CASE WHEN EXISTS (
        SELECT 1 FROM sent_parcels p JOIN shipments s ON s.id = p."shipmentId" WHERE s."orderId" = i."orderId"
      ) THEN COALESCE((SELECT SUM(p.qty) FROM sent_parcels p WHERE p.item_id = i.id), 0)::int ELSE i.qty END) AS qty) sent
    )
    SELECT json_build_object('sent', COALESCE(SUM(sent), 0)::int, 'returned', COALESCE(SUM(returned), 0)::int)
    FROM quantities
  )`;
}
