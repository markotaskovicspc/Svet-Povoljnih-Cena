import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),lines:vi.fn(),docs:vi.fn(),products:vi.fn(),transaction:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/db',()=>({db:{$transaction:mocks.transaction}}));
import {getDailyFinanceReport} from '@/lib/admin/daily-finance-report.server';
import {resolveReportPeriod} from '@/lib/admin/report-period';
it('loads full document totals and their costs in one read-only repeatable snapshot, and filters Ananas dates',async()=>{
 const issuedAt=new Date('2026-10-05T12:00:00Z');
 mocks.query.mockResolvedValue([{day:'2026-10-05',proforma_count:1,proforma_gross:1000,fiscal_sale_count:1,fiscal_sale_gross:1000,fiscal_refund_count:0,fiscal_refund_gross:0}]);
 mocks.lines.mockResolvedValue([{sku:'X',shortName:'Sto',qty:1,unitCogs:200,product:{cogs:300},originalSaleLine:null,fiscalDocument:{kind:'SALE',issuedAt}}]);
 mocks.docs.mockResolvedValue([{issuedAt,kind:'SALE',gross:1500,items:[{sku:'X',name:'Sto',quantity:2,gross:1500}]}]);mocks.products.mockResolvedValue([{sku:'X',cogs:300}]);
 mocks.transaction.mockImplementation(async fn=>fn({$queryRaw:mocks.query,fiscalDocumentLine:{findMany:mocks.lines},ananasDocument:{findMany:mocks.docs},product:{findMany:mocks.products}}));
 const period=resolveReportPeriod({range:'custom',from:'2026-10-05',to:'2026-10-05'});
 const [row]=await getDailyFinanceReport(period);
 expect(row).toMatchObject({fiscalSaleCount:2,fiscalSaleGross:2500,fiscalNetCogs:800,spcNetCogs:200,ananasNetCogs:600,estimatedCogsQty:2});
 expect(mocks.transaction.mock.calls[0][1]).toMatchObject({isolationLevel:'RepeatableRead'});
 expect(mocks.docs.mock.calls[0][0].where.issuedAt).toEqual({gte:period.start,lt:period.endExclusive});
 expect(mocks.lines.mock.calls[0][0].where.fiscalDocument.is.status).toBe('ISSUED');
});
