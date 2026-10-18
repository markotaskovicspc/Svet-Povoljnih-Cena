import { expect, it } from 'vitest';
import { parseExportQuery } from '@/lib/partners/spcapp/contract';
const now = new Date('2026-10-18T12:00:00Z');
const parse = (search = '', resource = 'orders', secret = 'secret') => parseExportQuery(resource, new URL(`https://erp.test/?${search}`), secret, now);
it('binds signed keyset cursors to resource, dates, filters and partner key; allows a smaller page', () => {
  const q = parse('from=2025-05-01&to=2026-10-18');
  const cursor = q.nextCursor('last-row');
  expect(parse(`from=2025-05-01&to=2026-10-18&limit=10&cursor=${cursor}`).after).toBe('last-row');
  expect(() => parse(`cursor=${cursor}`, 'inventory')).toThrow();
  expect(() => parse(`cursor=${cursor}`, 'orders', 'other-partner')).toThrow();
  expect(() => parse(`from=2025-05-02&cursor=${cursor}`)).toThrow();
  expect(() => parse(`cursor=${cursor.slice(0,-1)}x`)).toThrow();
});
it.each(['limit=0','limit=201','limit=1.5','from=2026-02-30','from=2026-12-01&to=2026-10-01','updatedSince=2026-10-01','limit=10&limit=20','status=POSTED','supplierPib=123','granularity=minute','basis=everything'])("rejects invalid/unsupported parameters: %s", search => expect(() => parse(search)).toThrow());
it('uses Serbian calendar bounds through DST and bounds performance periods', () => {
  const q = parse('from=2026-10-25&to=2026-10-25');
  expect(q.period.endExclusive.getTime()-q.period.start.getTime()).toBe(25*3600000);
  expect(() => parse('from=2025-05-01&to=2026-10-18','product-performance')).toThrow();
});
