import { Prisma } from "@prisma/client";
import { resolveReportPeriod } from "./report-period";
import { normalizeReturnParcelNumber, returnItemParcelNumbers, type ReturnShipment } from "./return-parcels";

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
      SELECT o.id, o.status,
        EXISTS (SELECT 1 FROM "OrderStatusEvent" e WHERE e."orderId" = o.id AND e.status = 'VRACENO') AS "wasReturned"
      FROM dispatched d JOIN "Order" o ON o.id = d."orderId"
      WHERE d.sent_at >= ${period.start} AND d.sent_at < ${period.endExclusive}
        AND d.sent_at <= ${now} ${warehouse}
    ), shipments AS (
      SELECT s.id, s."orderId", s.purpose, s.status, s.provider, s."trackingNo", s."packageCount",
        s."providerParcelNumbers", NULLIF(jsonb_strip_nulls(jsonb_build_object(
          'articleLabels', s."rawCreateResponse"->'articleLabels',
          'myGlsPackageAssignments', s."rawCreateResponse"->'myGlsPackageAssignments'
        )), '{}'::jsonb) AS "rawCreateResponse", s."reclamationId",
        r."orderItemId" AS "claimItemId", r.sku AS "claimSku", r.quantity AS "claimQuantity", r."replacementQty",
        s."shippedAt" <= ${now} OR EXISTS (SELECT 1 FROM "ShipmentEvent" e WHERE e."shipmentId" = s.id AND e.status = 'PICKED_UP' AND e."occurredAt" <= ${now})
          OR EXISTS (SELECT 1 FROM "PickupBatchLine" p WHERE p."shipmentId" = s.id AND p."courierPickedUpAt" <= ${now}) AS dispatched,
        CASE WHEN s.purpose = 'RECLAMATION_RETURN' THEN
          s.status = 'DELIVERED' OR EXISTS (SELECT 1 FROM "ShipmentEvent" e WHERE e."shipmentId" = s.id AND e.status = 'DELIVERED')
        ELSE s.status = 'RETURNED' OR EXISTS (SELECT 1 FROM "ShipmentEvent" e WHERE e."shipmentId" = s.id AND e.status = 'RETURNED') END AS returned
      FROM "Shipment" s JOIN cohort o ON o.id = s."orderId"
      LEFT JOIN "Reclamation" r ON r.id = s."reclamationId"
      WHERE s.purpose IN ('ORDER_DELIVERY', 'RECLAMATION_RETURN', 'RECLAMATION_REPLACEMENT')
    )
    SELECT json_build_object(
      'orders', (SELECT COALESCE(json_agg(o), '[]'::json) FROM cohort o),
      'items', (SELECT COALESCE(json_agg(i), '[]'::json) FROM (
        SELECT i.id, i."orderId", i.sku, i.qty, i."warehouseId" FROM "OrderItem" i JOIN cohort o ON o.id = i."orderId"
      ) i),
      'shipments', (SELECT COALESCE(json_agg(s), '[]'::json) FROM shipments s),
      'parcels', (SELECT COALESCE(json_agg(p), '[]'::json) FROM (
        SELECT p."shipmentId", p."providerParcelNumber", p."orderItemId", p."packedQuantity", p."packedItems"
        FROM "PickupBatchLine" p JOIN shipments s ON s.id = p."shipmentId"
        WHERE p."providerParcelNumber" IS NOT NULL
      ) p),
      'arrivals', (SELECT COALESCE(json_agg(a), '[]'::json) FROM (
        SELECT a."shipmentId", a."parcelNumber" FROM "ReturnParcelArrival" a JOIN shipments s ON s.id = a."shipmentId"
      ) a),
      'receipts', (SELECT COALESCE(json_agg(m), '[]'::json) FROM (
        SELECT m."orderId", m."orderItemId", m.sku, m.kind, m.qty, m."idempotencyKey"
        FROM "StockMovement" m JOIN cohort o ON o.id = m."orderId"
        WHERE m.kind = 'REFUND_RETURN'
      ) m)
    )
  )`;
}


type Item = { id: string; orderId: string; sku: string; qty: number; warehouseId: string | null };
type Shipment = ReturnShipment & {
  orderId: string; purpose: string; returned: boolean; dispatched: boolean;
  reclamationId: string | null; claimItemId: string | null; claimSku: string | null;
  claimQuantity: number | null; replacementQty: number | null;
};
export type DashboardReturnEvidence = {
  orders: { id: string; status: string; wasReturned: boolean }[];
  items: Item[];
  shipments: Shipment[];
  parcels: (NonNullable<ReturnShipment["pickupBatchLines"]>[number] & { shipmentId: string })[];
  arrivals: { shipmentId: string; parcelNumber: string }[];
  receipts: { orderId: string; orderItemId: string | null; sku: string; kind: string; qty: number; idempotencyKey: string | null }[];
};

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    const group = groups.get(value) ?? [];
    group.push(row); groups.set(value, group);
  }
  return groups;
}

/** Keep JSON expansion/parcel matching out of the dashboard SQL plan. */
export function summarizeDashboardReturns(evidence: DashboardReturnEvidence, warehouseId: string): DashboardReturnSummary {
  const parcels = groupBy(evidence.parcels, p => p.shipmentId);
  const arrivals = groupBy(evidence.arrivals, a => a.shipmentId);
  const items = groupBy(evidence.items, i => i.orderId);
  const shipments = groupBy(evidence.shipments.map(s => ({ ...s,
    pickupBatchLines: parcels.get(s.id) ?? [], returnArrivals: arrivals.get(s.id) ?? [],
  })), s => s.orderId);
  const receipts = groupBy(evidence.receipts, m => m.orderId);
  const summary = { sent: 0, returned: 0 };
  for (const order of evidence.orders) {
    const lines = items.get(order.id) ?? [];
    const outgoing = (shipments.get(order.id) ?? []).filter(s => s.purpose === 'ORDER_DELIVERY');
    const orderShipments = shipments.get(order.id) ?? [];
    const itemParcels = new Map<string, ReturnType<typeof returnItemParcelNumbers>>();
    for (const item of lines) {
      for (const shipment of orderShipments) {
        // Unknown historical packing must never turn a partial arrival into the whole order.
        let matches: ReturnType<typeof returnItemParcelNumbers> = [];
        try { matches = returnItemParcelNumbers(item, [shipment]); } catch { /* Invalid legacy packing has no usable quantity evidence. */ }
        itemParcels.set(`${item.id}:${shipment.id}`, matches);
      }
    }
    const dispatchedContents = lines.flatMap(item => outgoing.filter(s => s.dispatched).flatMap(s => itemParcels.get(`${item.id}:${s.id}`) ?? []));
    const hasDispatchedContents = dispatchedContents.length > 0 && dispatchedContents.every(p => p.quantity != null);
    for (const item of lines) {
      if (item.qty <= 0 || (warehouseId && item.warehouseId !== warehouseId)) continue;
      const sent = hasDispatchedContents ? Math.min(item.qty, outgoing.filter(s => s.dispatched).reduce((sum, s) =>
        sum + (itemParcels.get(`${item.id}:${s.id}`) ?? []).reduce((n, p) => n + (p.quantity ?? 0), 0), 0)) : item.qty;
      const courier = new Map<string, number>();
      const limits = new Map<string, number>();
      for (const shipment of orderShipments) {
        if (shipment.reclamationId && !(shipment.claimItemId === item.id || (!shipment.claimItemId && shipment.claimSku === item.sku))) continue;
        const source = shipment.reclamationId ? `claim:${shipment.reclamationId}` : 'order';
        const matches = itemParcels.get(`${item.id}:${shipment.id}`) ?? [];
        const arrived = new Set(shipment.returnArrivals.map(a => normalizeReturnParcelNumber(a.parcelNumber)));
        let quantity = matches.filter(p => arrived.size ? arrived.has(p.code) : shipment.returned).reduce((sum, p) => sum + (p.quantity ?? (item.qty === 1 ? 1 : 0)), 0);
        const hasPacking = shipment.pickupBatchLines.length > 0 || Boolean(shipment.rawCreateResponse && typeof shipment.rawCreateResponse === 'object' &&
          ('articleLabels' in shipment.rawCreateResponse || 'myGlsPackageAssignments' in shipment.rawCreateResponse));
        const completeReturn = (shipment.returned && !arrived.size) || (arrived.size > 0 && (shipment.packageCount ?? 1) <= arrived.size);
        if ((!hasPacking || (matches.length > 0 && matches.some(p => p.quantity == null))) && completeReturn) {
          quantity = shipment.reclamationId
            ? shipment.purpose === 'RECLAMATION_REPLACEMENT' ? shipment.replacementQty ?? shipment.claimQuantity ?? 0 : shipment.claimQuantity ?? 0
            : outgoing.length === 1 || lines.reduce((sum, i) => sum + i.qty, 0) === 1 ? item.qty : 0;
        }
        courier.set(source, (courier.get(source) ?? 0) + quantity);
        limits.set(source, shipment.claimQuantity ?? item.qty);
      }
      const posted = new Map<string, number>();
      let physicalUnits = 0;
      for (const receipt of receipts.get(order.id) ?? []) {
        if (!(receipt.orderItemId === item.id || (!receipt.orderItemId && receipt.sku === item.sku && lines.filter(i => i.sku === item.sku).length === 1))) continue;
        const source = receipt.idempotencyKey?.startsWith('reclamation-return:') ? `claim:${receipt.idempotencyKey.split(':')[1]}` : 'order';
        posted.set(source, (posted.get(source) ?? 0) + Math.max(0, receipt.qty));
        if (receipt.idempotencyKey?.startsWith('order-return:')) physicalUnits++;
      }
      posted.set('order', Math.max(posted.get('order') ?? 0, physicalUnits));
      let returned = 0;
      for (const source of new Set([...courier.keys(), ...posted.keys()])) {
        returned += Math.min(limits.get(source) ?? item.qty, Math.max(courier.get(source) ?? 0, posted.get(source) ?? 0));
      }
      if (!returned && !orderShipments.some(s => s.returned || s.returnArrivals.length) && (order.status === 'VRACENO' || order.wasReturned)) returned = item.qty;
      summary.sent += sent;
      summary.returned += Math.min(sent, returned);
    }
  }
  return summary;
}
