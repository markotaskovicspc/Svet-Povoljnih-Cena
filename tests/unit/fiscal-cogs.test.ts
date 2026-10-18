import { expect, it } from 'vitest';
import { resolveFiscalCogs, type FiscalCostHistory } from '@/lib/admin/fiscal-cogs';

const history: FiscalCostHistory = {
  receipts: [
    { day: '2026-10-01', unitCogs: 100, estimated: false },
    { day: '2026-10-16', unitCogs: 200, estimated: false },
  ], prices: [], current: 999,
};
it('uses dated costs, first available fallback and the saved fiscal snapshot including zero', () => {
  expect(resolveFiscalCogs(history, new Date('2026-10-15T12:00:00Z'))).toEqual({ unitCogs: 100, estimated: false });
  expect(resolveFiscalCogs(history, new Date('2026-09-01'))).toEqual({ unitCogs: 100, estimated: true });
  expect(resolveFiscalCogs(history, new Date('2026-10-17'))).toEqual({ unitCogs: 200, estimated: false });
  expect(resolveFiscalCogs(history, new Date('2026-10-17'), 0)).toEqual({ unitCogs: 0, estimated: false });
});
it('resolves Serbian calendar dates and inclusive purchase-price end dates', () => {
  const prices = { receipts: [], current: null, prices: [
    { day: '2026-10-15', through: '2026-10-15', unitCogs: 0, estimated: true },
    { day: '2026-10-16', through: null, unitCogs: 200, estimated: true },
  ] };
  expect(resolveFiscalCogs(prices, new Date('2026-10-15T20:00:00Z')).unitCogs).toBe(0);
  expect(resolveFiscalCogs(prices, new Date('2026-10-15T22:30:00Z')).unitCogs).toBe(200);
});
it('distinguishes missing costs from zero and rejects invalid current costs', () => {
  expect(resolveFiscalCogs(undefined, new Date()).unitCogs).toBeNull();
  expect(resolveFiscalCogs({ receipts: [], prices: [], current: 0 }, new Date())).toEqual({ unitCogs: 0, estimated: true });
  expect(resolveFiscalCogs({ receipts: [], prices: [], current: -5 }, new Date()).unitCogs).toBeNull();
});
