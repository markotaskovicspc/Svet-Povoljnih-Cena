import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { inboundInvoice: { findMany: mocks.list } } }));
import { parseExportQuery } from '@/lib/partners/spcapp/contract';
import { exportResource } from '@/lib/partners/spcapp/export.server';

const query = (resource = 'goods-receipts', cursor = '') => parseExportQuery(resource,
  new URL(`https://erp.test?from=2026-10-25&to=2026-10-25&limit=2${cursor ? `&cursor=${cursor}` : ''}`), 'secret');
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([]); });

it('routes goods receipts to posted receipt data with Belgrade dates, fallback dates and bounded pagination', async () => {
  const q = query();
  await exportResource(q);
  expect(mocks.list.mock.lastCall![0]).toMatchObject({
    where: { id: { gt: '' }, status: 'POSTED', OR: [
      { invoiceDate: { gte: new Date('2026-10-24T22:00:00Z'), lt: new Date('2026-10-25T23:00:00Z') } },
      { invoiceDate: null, createdAt: { gte: new Date('2026-10-24T22:00:00Z'), lt: new Date('2026-10-25T23:00:00Z') } },
    ] }, orderBy: { id: 'asc' }, take: 3,
  });
  await exportResource(query('goods-receipts', q.nextCursor('last-receipt')));
  expect(mocks.list.mock.lastCall![0].where.id).toEqual({ gt: 'last-receipt' });
  expect(() => query('inbound-invoices', q.nextCursor('last-receipt'))).toThrow();
});

it('preserves the existing receipt IDs, amounts and VAT limitations without duplicating the export implementation', async () => {
  mocks.list.mockResolvedValue([{ id: 'receipt', number: 'PR-1', vatValue: '200.50', supplier: { id: 'supplier', name: 'Supplier' } }]);
  const receipts = await exportResource(query());
  expect(receipts).toEqual(await exportResource(query('inbound-invoices')));
  expect(receipts[0]).toMatchObject({ id: 'receipt', recordedInvoiceVat: '200.50', importVat: null, importVatStatus: 'NOT_SEPARATELY_RECORDED' });
});
