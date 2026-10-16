import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ shipments: vi.fn(), lines: vi.fn(), fiscal: vi.fn(), legacy: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: {
 shipment: { findMany: mocks.shipments }, courierStatementLine: { findMany: mocks.lines },
 fiscalDocument: { findMany: mocks.fiscal }, fiscalReceipt: { count: mocks.legacy },
} }));
import { courierFinanceReport } from '@/lib/courier/finance-report.server';
import { resolveReportPeriod } from '@/lib/admin/report-period';
const shipment = {
 id:'s', orderId:'o', order:{id:'o',number:'SPC-2026-001230'}, provider:'X_EXPRESS', purpose:'ORDER_DELIVERY',
 trackingNo:'AAA0850301609',status:'DELIVERED',packageCount:1,codAmount:998,
 deliveredAt:new Date('2026-10-06T12:00Z'),lastStatusEventAt:null,syncError:null,events:[],
 rawCreateResponse:{packages:[{Mass:1}]},courierStatementLines:[],
};
beforeEach(() => {
 mocks.shipments.mockResolvedValue([shipment]);mocks.lines.mockResolvedValue([]);
 mocks.fiscal.mockResolvedValue([]);mocks.legacy.mockResolvedValue(0);
});
const period=resolveReportPeriod({range:'custom',from:'2026-10-01',to:'2026-10-16'});
it('keeps a valid estimate but does not invent actual costs or a zero payment', async () => {
 const {rows}=await courierFinanceReport(period);
 expect(rows[0]).toMatchObject({base:290,actual:null,difference:null,expectedCod:998,cod:null,codStatus:'NO_STATEMENT'});
});
it('retains imported costs even without historical GLS weight', async () => {
 mocks.shipments.mockResolvedValue([{...shipment,provider:'MYGLS',rawCreateResponse:{},courierStatementLines:[{kind:'COST',amountNet:489}]}]);
 const {rows}=await courierFinanceReport(period);
 expect(rows[0]).toMatchObject({base:null,actual:489,difference:null,codStatus:'NO_STATEMENT',baseUnavailable:'Nije sačuvana težina poslata kuriru za sve pakete'});
});
it('compares actual imported remittances and retains genuine shortages', async () => {
 mocks.shipments.mockResolvedValue([{...shipment,courierStatementLines:[{kind:'COD',amountGross:600},{kind:'COST',amountNet:300}]}]);
 const {rows}=await courierFinanceReport(period);
 expect(rows[0]).toMatchObject({base:290,actual:300,difference:10,cod:600,codStatus:'SHORT'});
});
it('recovers historical GLS base from exact saved parcel weights and COD assignments', async () => {
 mocks.shipments.mockResolvedValue([{...shipment,provider:'MYGLS',trackingNo:'9002787296',providerParcelNumbers:['9002787296'],rawCreateResponse:{myGlsPackageAssignments:[{parcelNumber:9002787296,codAmount:1998}]},pickupBatchLines:[{providerParcelNumber:'9002787296',weightKg:7}],courierStatementLines:[{kind:'COST',amountNet:489}]}]);
 const {rows}=await courierFinanceReport(period);
 expect(rows[0]).toMatchObject({base:425,actual:489,difference:64,cod:null,codStatus:'NO_STATEMENT'});
});
