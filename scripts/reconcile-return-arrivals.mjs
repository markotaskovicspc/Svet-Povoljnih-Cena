// Dry-run by default. Input: JSON array of physically observed parcel codes.
// This only records arrival evidence; it never adjusts stock or refunds.
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { normalizeReturnParcelNumber, returnParcelNumbers } from '../src/lib/admin/return-parcels.ts';
const { values } = parseArgs({ options: { file: { type: 'string' }, env: { type: 'string', default: '.env.local' }, note: { type: 'string' }, apply: { type: 'boolean', default: false } } });
if (!values.file || (values.apply && !values.note?.trim())) throw new Error('Required: --file codes.json; --apply also requires --note describing the source.');
const input = JSON.parse(readFileSync(values.file, 'utf8'));
if (!Array.isArray(input) || !input.length || input.some(code => typeof code !== 'string' || !/^[A-Z0-9]{5,40}$/.test(normalizeReturnParcelNumber(code)))) throw new Error('Invalid parcel list.');
const codes = [...new Set(input.map(normalizeReturnParcelNumber))];
config({ path: values.env, quiet: true });
const url = new URL(process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL);
if (url.port === '6543') throw new Error('Use the non-pooling connection.');
const schema = url.searchParams.get('schema') || 'public';
url.searchParams.delete('schema');
url.searchParams.set('sslmode', 'no-verify');
url.searchParams.delete('uselibpqcompat');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString(), max: 3 }, { schema }) });
try {
  const shipments = await db.shipment.findMany({
    where: { purpose: { in: ['ORDER_DELIVERY', 'RECLAMATION_RETURN'] }, OR: codes.flatMap(code => [
      { trackingNo: { in: [code, /^\d+$/.test(code) ? code.padStart(11, '0') : code] } },
      { providerParcelNumbers: { array_contains: [code] } },
      { providerParcelNumbers: { array_contains: [code.padStart(11, '0')] } },
      ...(Number.isSafeInteger(Number(code)) ? [{ providerParcelNumbers: { array_contains: [Number(code)] } }] : []),
    ]) },
    select: { id: true, orderId: true, trackingNo: true, providerParcelNumbers: true, status: true, order: { select: { number: true } } },
  });
  const rows = codes.map(code => {
    const matches = shipments.filter(shipment => returnParcelNumbers(shipment).includes(code));
    if (matches.length !== 1) throw new Error(`${code}: found ${matches.length} matching shipments; nothing applied.`);
    return { code, shipment: matches[0] };
  });
  console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'dry-run', parcels: rows.map(({ code, shipment }) => ({ code, order: shipment.order.number, shipmentId: shipment.id, courierStatus: shipment.status })) }, null, 2));
  if (values.apply) {
    await db.$transaction(async tx => {
      for (const { code, shipment } of rows) {
        await tx.returnParcelArrival.upsert({
          where: { shipmentId_parcelNumber: { shipmentId: shipment.id, parcelNumber: code } },
          create: { shipmentId: shipment.id, parcelNumber: code, note: values.note.trim() }, update: {},
        });
      }
      await tx.auditLog.create({ data: { action: 'return.parcel.arrival.reconcile', entity: 'ReturnParcelArrival', diff: { source: values.note.trim(), parcels: rows.map(({ code, shipment }) => ({ parcelNumber: code, shipmentId: shipment.id })) } } });
    }, { timeout: 30000 });
    console.log(`Verified arrival records: ${await db.returnParcelArrival.count({ where: { OR: rows.map(({ code, shipment }) => ({ shipmentId: shipment.id, parcelNumber: code })) } })}/${codes.length}. Stock and refunds unchanged.`);
  }
} finally { await db.$disconnect(); }
