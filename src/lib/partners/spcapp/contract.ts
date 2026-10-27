import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveReportPeriod, dateInputInTimeZone } from '@/lib/admin/report-period';

export const API_VERSION = '1';
export const RESOURCES = {
  'spc-reclamations': 'Registered SPC claims only: excludes ANANAS orders; no customer data',
  'delivered-articles': 'Physical SPC delivered order items, quantities and recorded delivery dates; no Ananas, services, money or customer data',
  reclamations: 'Registered claims by registration date, article code and quantity; customer name only with history=all',
  orders: 'SPC orders, item amounts, discounts, courier and actual parcels',
  'ananas-orders': 'Imported Ananas orders; unavailable fields are null',
  'fiscal-documents': 'Issued SPC sales/refunds with merchandise, services and COGS',
  'legacy-fiscal-receipts': 'Legacy SPC receipt headers without issued FiscalDocument; incomplete item history',
  'ananas-fiscal-documents': 'Imported Ananas sales/refunds with recalculated COGS',
  products: 'All articles, including deleted tombstones and catalogEligible flag',
  inventory: 'Physical, reserved and available quantities by warehouse',
  prices: 'Stored price lists, purchase quotes and loyalty price history by article',
  'loyalty-rules': 'Global and article-specific loyalty rules with validity periods',
  promotions: 'Stored campaigns, article prices and periods',
  'purchase-orders': 'Purchase orders; optionally status=DRAFT (U obradi)',
  'inbound-invoices': 'Posted goods receipts; import VAT not separately classified',
  'goods-receipts': 'Posted goods receipts; same records and fields as inbound-invoices',
  shipments: 'SPC shipments, parcel dimensions, order/invoice/receipt references',
  'courier-statements': 'Imported courier charges and remittances',
  'sef-invoices': 'Incoming SEF invoices, attachment metadata; optional supplierPib',
  traffic: 'Consented page views, unique visitors and sessions per bucket',
  customers: 'SPC unique/new/returning buyers per bucket; Ananas identity incomplete',
  'product-performance': 'Existing WEB product-performance calculation for a period',
} as const;
export type Resource = keyof typeof RESOURCES;
export class ExportInputError extends Error {}
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function parseExportQuery(resource: string, url: URL, secret: string, now = new Date()) {
  if (!(Object.prototype.hasOwnProperty.call(RESOURCES, resource))) throw new ExportInputError('Unknown resource.');
  const allowed = new Set(['from', 'to', 'limit', 'cursor', 'granularity', 'status', 'supplierPib', 'basis', 'history']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new ExportInputError(`Unsupported or repeated parameter: ${key}`);
  const from = url.searchParams.get('from') ?? (resource === 'product-performance' ? resolveReportPeriod({ range: '30d' }, now).fromInput : '2025-05-01');
  const to = url.searchParams.get('to') ?? dateInputInTimeZone(now);
  if (!validDate(from) || !validDate(to) || from > to) throw new ExportInputError('Expected from <= to, YYYY-MM-DD.');
  const period = resolveReportPeriod({ range: 'custom', from, to }, now);
  if (resource === 'product-performance' && period.endExclusive.getTime() - period.start.getTime() > 366 * 86400000) throw new ExportInputError('Performance period is limited to 366 days.');
  const rawLimit = url.searchParams.get('limit') ?? '100';
  if (!/^\d+$/.test(rawLimit)) throw new ExportInputError('limit must be an integer from 1 to 200.');
  const limit = Number(rawLimit);
  if (limit < 1 || limit > 200) throw new ExportInputError('limit must be an integer from 1 to 200.');
  const granularity = url.searchParams.get('granularity') ?? 'day';
  if (!['5minute', 'hour', 'day', 'month', 'year'].includes(granularity)) throw new ExportInputError('Invalid granularity.');
  if (granularity === '5minute' && (resource !== 'traffic' || from !== to)) throw new ExportInputError('5minute traffic requires a single day.');
  const basis = url.searchParams.get('basis') ?? 'orders';
  if (!['orders', 'fiscal'].includes(basis)) throw new ExportInputError('Invalid customer basis.');
  const status = url.searchParams.get('status');
  if (status && (resource !== 'purchase-orders' || !['DRAFT', 'SENT', 'CONFIRMED', 'RECEIVED', 'CANCELLED'].includes(status))) throw new ExportInputError('Invalid status filter.');
  const supplierPib = url.searchParams.get('supplierPib');
  if (supplierPib && (resource !== 'sef-invoices' || !/^\d{9}$/.test(supplierPib))) throw new ExportInputError('Invalid supplierPib.');
  const history = url.searchParams.get('history');
  if (url.searchParams.has('history') && (resource !== 'reclamations' || history !== 'all')) throw new ExportInputError('Invalid history filter.');
  const binding = JSON.stringify([resource, from, to, granularity, basis, status, supplierPib, ...(history ? [history] : [])]);
  let after = '';
  const cursor = url.searchParams.get('cursor');
  if (cursor) {
    if (cursor.length > 3000) throw new ExportInputError('Invalid cursor.');
    const [body, mac, extra] = cursor.split('.');
    const expected = createHmac('sha256', secret).update(body ?? '').digest('hex');
    if (!body || !mac || extra || !/^[a-f0-9]{64}$/.test(mac) || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new ExportInputError('Invalid cursor.');
    try {
      const decoded = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (decoded.binding !== binding || typeof decoded.after !== 'string' || !decoded.after || decoded.after.length > 200) throw new Error();
      after = decoded.after;
    } catch { throw new ExportInputError('Cursor does not match this export.'); }
  }
  return { resource: resource as Resource, period, limit, after, granularity: granularity as '5minute' | 'hour' | 'day' | 'month' | 'year', basis, status, supplierPib, history,
    nextCursor(lastId: string) {
      const body = Buffer.from(JSON.stringify({ binding, after: lastId })).toString('base64url');
      return `${body}.${createHmac('sha256', secret).update(body).digest('hex')}`;
    },
  };
}
export type ExportQuery = ReturnType<typeof parseExportQuery>;
export const money = (value: unknown) => value == null ? null : Number(value).toFixed(2);
export const n = (value: unknown) => value == null ? null : Number(value);
export const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function customerKey(order: { customerId: string | null; userId: string | null }) {
  return order.customerId ? `customer:${order.customerId}` : order.userId ? `user:${order.userId}` : null;
}
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? Number(item) : item));
}
