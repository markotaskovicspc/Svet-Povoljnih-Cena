import { Prisma } from "@prisma/client";
import { resolveReportPeriod } from "./report-period";

export type DashboardReturnSummary = { sent: number; returned: number };

/** One order per first recorded dispatch; never use order/label creation as dispatch. */
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
    )
    SELECT json_build_object(
      'sent', COUNT(*)::int,
      'returned', COUNT(*) FILTER (WHERE o.status = 'VRACENO'
        OR EXISTS (SELECT 1 FROM "OrderStatusEvent" e WHERE e."orderId" = o.id AND e.status = 'VRACENO')
        OR EXISTS (SELECT 1 FROM "StockMovement" m WHERE m."orderId" = o.id AND m.kind = 'REFUND_RETURN' AND m.qty > 0)
        OR EXISTS (
          SELECT 1 FROM "Shipment" s WHERE s."orderId" = o.id AND (
            (s.purpose IN ('ORDER_DELIVERY', 'RECLAMATION_REPLACEMENT') AND (s.status = 'RETURNED' OR EXISTS (
              SELECT 1 FROM "ShipmentEvent" e WHERE e."shipmentId" = s.id AND e.status = 'RETURNED'
            )))
            OR (s.purpose = 'RECLAMATION_RETURN' AND (s.status = 'DELIVERED' OR EXISTS (
              SELECT 1 FROM "ShipmentEvent" e WHERE e."shipmentId" = s.id AND e.status = 'DELIVERED'
            )))
            OR (s.purpose IN ('ORDER_DELIVERY', 'RECLAMATION_REPLACEMENT', 'RECLAMATION_RETURN') AND EXISTS (
              SELECT 1 FROM "ReturnParcelArrival" a WHERE a."shipmentId" = s.id
            ))
          )
        )
      )::int
    ) FROM dispatched d JOIN "Order" o ON o.id = d."orderId"
      WHERE d.sent_at >= ${period.start} AND d.sent_at < ${period.endExclusive}
        AND d.sent_at <= ${now} ${warehouse}
  )`;
}
