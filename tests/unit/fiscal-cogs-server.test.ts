import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ products: vi.fn(), prices: vi.fn(), invoices: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {
  product: { findMany: mocks.products }, purchasePrice: { findMany: mocks.prices }, inboundInvoice: { findMany: mocks.invoices },
} }));
import { loadFiscalCogs } from '@/lib/admin/fiscal-cogs.server';

it('reuses posted landed-cost allocations and weights prior stock exactly as SPC booking', async () => {
  mocks.products.mockResolvedValue([{ sku: 'A', cogs: 999 }]);
  mocks.prices.mockResolvedValue([]);
  mocks.invoices.mockResolvedValue([{ invoiceDate: new Date('2025-01-01'), lockedAt: new Date('2026-10-18'), purchaseOrder: {
    exchangeRate: 2, cogsBookingSnapshot: { version: 1, products: [{ productId: 'a', sku: 'A', stock: 10, cogs: 100 }] },
    items: [{ sku: 'A', productId: 'a', qty: 5, purchasePrice: 100, customsRate: 10, freightAllocated: 100, additionalCostAllocated: 50 },
      { sku: 'A', productId: 'a', qty: 5, purchasePrice: 100, customsRate: 10, freightAllocated: 100, additionalCostAllocated: 50 }],
  } }]);
  const costAt = await loadFiscalCogs(['A', 'A']);
  // Incoming 250/unit (FX, customs, freight, invoice adjustment); weighted with 10 x 100.
  expect(costAt('A', new Date('2025-06-01'))).toEqual({ unitCogs: 175, estimated: false });
  expect(costAt('A', new Date('2024-06-01'))).toEqual({ unitCogs: 175, estimated: true });
  expect(mocks.invoices.mock.calls[0][0].where).toMatchObject({ status: 'POSTED', lockedAt: { not: null } });
});
