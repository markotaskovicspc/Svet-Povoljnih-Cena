import { beforeEach, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { jsonSafe, parseExportQuery } from '@/lib/partners/spcapp/contract';

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { purchaseOrder: { findMany: mocks.findMany } } }));
import { exportPurchaseOrders } from '@/lib/partners/spcapp/catalog.server';

const decimal = (value: string) => new Prisma.Decimal(value);
const existing = {
  id: 'po1', number: 'PO-1', status: 'DRAFT', currency: 'EUR', exchangeRate: decimal('117.2'),
  totalPrice: decimal('10000'), totalVolume: decimal('1.5'),
  supplier: { id: 'supplier1', name: 'Supplier' }, items: [{ id: 'item1', qty: 2 }],
};
const query = () => parseExportQuery('purchase-orders', new URL('https://erp.test?from=2026-10-01&to=2026-10-30&status=DRAFT&limit=1'), 'secret');
beforeEach(() => vi.clearAllMocks());

it('exports numeric transport cost and string rate while preserving existing fields and query boundaries', async () => {
  mocks.findMany.mockResolvedValue([{ ...existing, freightCost: decimal('6000'), freightCurrency: 'USD', freightExchangeRate: decimal('102') }]);
  const q = query();
  const [row] = await exportPurchaseOrders(q);
  expect(row).toEqual({ ...existing, transportCost: 6000, transportCurrency: 'USD', transportExchangeRate: '102' });
  expect(jsonSafe(row)).toMatchObject({ transportCost: 6000, transportExchangeRate: '102', exchangeRate: '117.2' });
  expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: { gt: '' }, createdAt: { gte: q.period.start, lt: q.period.endExclusive }, status: 'DRAFT' },
    orderBy: { id: 'asc' }, take: 2,
    select: expect.objectContaining({ freightCost: true, freightCurrency: true, freightExchangeRate: true }),
  }));
  expect(row).not.toHaveProperty('payments');
  expect(row).not.toHaveProperty('freightCost');
});

it('exports zero RSD transport with a unit rate', async () => {
  mocks.findMany.mockResolvedValue([{ ...existing, freightCost: decimal('0'), freightCurrency: 'RSD', freightExchangeRate: decimal('102') }]);
  expect((await exportPurchaseOrders(query()))[0]).toMatchObject({ transportCost: 0, transportCurrency: 'RSD', transportExchangeRate: '1' });
});

it('uses the order rate when the foreign transport rate is missing', async () => {
  mocks.findMany.mockResolvedValue([{ ...existing, freightCost: decimal('100.25'), freightCurrency: 'EUR', freightExchangeRate: null }]);
  expect((await exportPurchaseOrders(query()))[0]).toMatchObject({ transportCost: 100.25, transportCurrency: 'EUR', transportExchangeRate: '117.2' });
});
