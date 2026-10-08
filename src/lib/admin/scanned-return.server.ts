import 'server-only';
import { db } from '@/lib/db';
import { findReturnParcel, confirmReturnParcelArrival } from './return-arrival.server';
import { reclamationParcelQuantity } from './return-receipt-plan';
import { returnUnitParcelNumbers } from './return-parcels';
import { receiveReclamationReturn } from './reclamation-fulfillment.server';
import { receiveReturnedOrderUnit } from './returned-orders.server';
import { receiveReshipmentReturn } from './order-reshipment.server';

export async function scannedReturnPlan(input: string) {
  const { shipment, code } = await findReturnParcel(input);
  if (shipment.syncError === 'MyGLS etiketa obrisana.') throw new Error('Povratna adresnica je otkazana. Potrebna je ručna provera.');
  const key = shipment.reclamation ? `reclamation:${shipment.reclamation.id}` : shipment.reshipment ? `reshipment:${shipment.reshipment.id}` : `order:${shipment.orderId}`;
  if (await db.returnResolution.findUnique({ where: { key } })) throw new Error('Povrat je zatvoren kao izgubljen. Otvorite evidenciju za proveru.');
  if (shipment.reclamation) {
    const claim = shipment.reclamation;
    const qty = reclamationParcelQuantity(shipment, { id: claim.orderItemId ?? '', sku: claim.sku, qty: claim.quantity }, code);
    const receipts = await db.stockMovement.findMany({ where: { OR: [
      { idempotencyKey: `reclamation-return:${claim.id}` },
      { idempotencyKey: `reclamation-return:${claim.id}:parcel:${code}` },
    ] } });
    return { shipment, code, kind: 'reclamation' as const, lines: [{ id: claim.orderItemId ?? claim.id, sku: claim.sku, name: shipment.order.items.find(i => i.id === claim.orderItemId)?.name ?? claim.sku, units: Array.from({ length: qty }, (_, i) => i + 1) }], received: receipts.length > 0 };
  }
  const items = shipment.reshipment ? shipment.reshipment.items.map(item => ({ ...item, id: item.orderItemId, receiptItemId: item.id, qty: item.quantity })) : shipment.order.items.map(item => ({ ...item, receiptItemId: item.id }));
  const lines = items.flatMap(item => {
    const units: number[] = [];
    for (let unit = 1; unit <= item.qty; unit++) {
      const match = returnUnitParcelNumbers(item, [shipment], unit);
      if (match.exact && match.parcels.some(p => p.code === code)) units.push(unit);
    }
    return units.length ? [{ id: item.receiptItemId, sku: item.sku, name: item.name, units }] : [];
  });
  if (!lines.length) throw new Error('Sadržaj paketa nije pouzdano povezan. Potrebna je ručna provera u evidenciji.');
  const keys = lines.flatMap(line => line.units.map(unit => shipment.reshipment ? `reshipment-return:${line.id}:${unit}` : `order-return:${shipment.order.number}:${line.id}:${unit}`));
  const receipts = await db.stockMovement.findMany({ where: { idempotencyKey: { in: keys } }, select: { idempotencyKey: true } });
  return { shipment, code, kind: shipment.reshipment ? 'reshipment' as const : 'order' as const, lines, received: receipts.length === keys.length };
}

export async function receiveScannedReturn(input: { code: string; warehouseId: string; actorId: string; buyerId?: string }) {
  const warehouse = await db.warehouse.findFirst({ where: { id: input.warehouseId, active: true }, select: { id: true, code: true, name: true } });
  if (!warehouse) throw new Error('Izaberite aktivan magacin prijema.');
  const plan = await scannedReturnPlan(input.code);
  if (plan.received) return { warehouse, orderId: plan.shipment.orderId, alreadyReceived: true, jobIds: [] as string[] };
  // Physical arrival remains valid evidence if a later stock/fiscal step fails.
  // Each receipt has a stable key, so retry cannot post a unit twice.
  await confirmReturnParcelArrival({ code: input.code, actorId: input.actorId });
  const jobIds: string[] = [];
  if (plan.kind === 'reclamation') {
    await receiveReclamationReturn({ reclamationId: plan.shipment.reclamation!.id, parcelNumber: plan.code, warehouseId: warehouse.id, actorId: input.actorId });
  } else {
    for (const line of plan.lines) for (const unitNo of line.units) {
      if (plan.kind === 'reshipment') await receiveReshipmentReturn({ itemId: line.id, unitNo, warehouseId: warehouse.id, actorId: input.actorId });
      else {
        const result = await receiveReturnedOrderUnit({ orderId: plan.shipment.orderId, orderItemId: line.id, unitNo, warehouseId: warehouse.id, actorId: input.actorId, buyerId: input.buyerId });
        jobIds.push(result.jobId);
      }
    }
  }
  return { warehouse, orderId: plan.shipment.orderId, alreadyReceived: false, jobIds };
}
