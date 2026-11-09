import { expect, it } from 'vitest';
import { discountDifference, entryFromLines, entryId, fiscalLineWarehouse, mpcFor, pageEntries, qtyAt, retailPriceAt, type RetailPrice } from '@/lib/partners/spcapp/kep';
import { parseExportQuery } from '@/lib/partners/spcapp/contract';

const list = { code: 'MP', active: true, validFrom: null, validTo: null };
const history: RetailPrice[] = [
  { price: 1000, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null, priceList: list },
  { price: 900, validFrom: new Date('2026-11-03T00:00:00Z'), validTo: null, priceList: list },
];

it('uses the retail price valid at the moment and flags the article-card fallback', () => {
  expect(retailPriceAt(history, new Date('2026-11-02T12:00:00Z'))).toBe(1000);
  expect(retailPriceAt(history, new Date('2026-11-03T12:00:00Z'))).toBe(900);
  expect(mpcFor([], 1500, new Date())).toEqual({ price: 1500, fallback: true });
  expect(mpcFor([], null, new Date())).toEqual({ price: null, fallback: false });
});

it('books reductions as a red storno in the same column and leaves the amount unknown when a price is missing', () => {
  const base = { id: entryId('2026-11-04', 'DC', 'TRANSFER_OUT', 'n1'), date: '2026-11-04', warehouseId: 'w', warehouseCode: 'DC', warehouseName: 'DC', kind: 'TRANSFER_OUT' as const,
    documentType: 'Prenos – izlaz', documentNumber: 'PRN-9', documentDate: '2026-11-04', partner: 'Ananas' };
  const out = entryFromLines(base, 'debit', -1, [{ sku: 'A', name: null, qty: 2, unitMpc: 100, value: 200 }]);
  expect(out).toMatchObject({ debit: -200, credit: null, complete: true });
  const unknown = entryFromLines(base, 'debit', -1, [{ sku: 'A', name: null, qty: 2, unitMpc: null, value: null }]);
  expect(unknown).toMatchObject({ debit: null, complete: false, missingMpcSkus: ['A'] });
});

it('finds the warehouse of a fiscal line without guessing', () => {
  expect(fiscalLineWarehouse({ movementWarehouseId: 'm', orderItemWarehouseId: 'o', documentWarehouseId: 'd' })).toBe('m');
  expect(fiscalLineWarehouse({ movementWarehouseId: null, orderItemWarehouseId: 'o', documentWarehouseId: 'd' })).toBe('o');
  expect(fiscalLineWarehouse({ movementWarehouseId: null, orderItemWarehouseId: null, documentWarehouseId: null })).toBeNull();
});

it('reconstructs stock at a moment and values discounts like the ERP leveling register', () => {
  expect(qtyAt(10, [{ createdAt: new Date('2026-11-05'), qty: -3 }, { createdAt: new Date('2026-11-01'), qty: 5 }], new Date('2026-11-03'))).toBe(13);
  expect(discountDifference('SALE', 2, 1000, 800)).toBe(-400);
  expect(discountDifference('REFUND', 1, 1000, 800)).toBe(200);
});

it('pages by id after the cursor and validates the new resources', () => {
  expect(pageEntries([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a', 1)).toEqual([{ id: 'b' }, { id: 'c' }]);
  const q = parseExportQuery('kep-entries', new URL('https://erp.test?from=2026-11-01&to=2026-11-30'), 'secret');
  expect(q.resource).toBe('kep-entries');
  expect(parseExportQuery('kep-opening', new URL('https://erp.test?from=2026-01-01&to=2026-01-01'), 'secret').resource).toBe('kep-opening');
});
