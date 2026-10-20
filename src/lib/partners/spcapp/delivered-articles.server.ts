import 'server-only';
import { db } from '@/lib/db';
import { type ExportQuery } from './contract';
/** Same physical SPC delivery definition as dashboard-data: delivered order, latest delivered shipment or first delivered status event. */
export async function exportDeliveredArticles(q: ExportQuery) {
  return db.$queryRaw<{id:string;orderNumber:string;sku:string;quantity:number;deliveredAt:Date|null}[]>`
    SELECT oi.id, o.number AS "orderNumber", oi.sku, oi.qty AS quantity, delivery."deliveredAt"
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
    JOIN LATERAL (
      SELECT COALESCE(
        (SELECT MAX(s."deliveredAt") FROM "Shipment" s WHERE s."orderId" = o.id AND s.purpose = 'ORDER_DELIVERY' AND s.status = 'DELIVERED'),
        (SELECT MIN(e."createdAt") FROM "OrderStatusEvent" e WHERE e."orderId" = o.id AND e.status = 'ISPORUCENO')
      ) AS "deliveredAt"
    ) delivery ON true
    WHERE o.status = 'ISPORUCENO' AND o.channel <> 'ANANAS' AND oi.id > ${q.after}
      AND (delivery."deliveredAt" IS NULL OR (delivery."deliveredAt" >= ${q.period.start} AND delivery."deliveredAt" < ${q.period.endExclusive}))
    ORDER BY oi.id ASC LIMIT ${q.limit + 1}
  `;
}
