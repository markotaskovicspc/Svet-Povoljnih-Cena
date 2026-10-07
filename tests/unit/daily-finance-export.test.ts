import {expect,it,vi} from 'vitest';
import ExcelJS from 'exceljs';
import {combineDailyFinance} from '@/lib/admin/daily-finance-report';
const mocks=vi.hoisted(()=>({report:vi.fn(),auth:vi.fn()}));
vi.mock('@/lib/admin',()=>({requireAdminAction:mocks.auth}));
vi.mock('@/lib/admin/daily-finance-report.server',async()=>{const actual=await import('@/lib/admin/daily-finance-report');return {getDailyFinanceReport:mocks.report,summarizeDailyFinanceReport:actual.summarizeDailyFinanceReport};});
import {GET} from '@/app/api/admin/reports/daily-finance/export/route';
it('exports the same channel and COGS totals as the screen, including explicit estimate warnings',async()=>{
 const [row]=combineDailyFinance([{day:'2026-10-05',proformaCount:0,proformaGross:0,fiscalSaleCount:1,fiscalSaleGross:1000,fiscalRefundCount:0,fiscalRefundGross:0,fiscalNetGross:1000}],[],[{issuedAt:new Date('2026-10-05T12:00:00Z'),kind:'SALE',gross:800,items:[{sku:'X',name:'Sto',quantity:2,gross:800}]}],new Map([['X',200]]),'ANANAS');
 mocks.report.mockResolvedValue([row]);const r=await GET(new Request('https://spc.test/api/admin/reports/daily-finance/export?range=custom&from=2026-10-05&to=2026-10-05&channel=ANANAS'));
 expect(mocks.auth).toHaveBeenCalledWith(['OPS']);expect(mocks.report.mock.calls[0][1]).toBe('ANANAS');
 const w=new ExcelJS.Workbook();await w.xlsx.load(Buffer.from(await r.arrayBuffer()) as unknown as Parameters<typeof w.xlsx.load>[0]);const sheet=w.getWorksheet('Dnevni promet')!;
 expect(sheet.getCell('J2').value).toBe(800);expect(sheet.getCell('M2').value).toBe(400);expect(sheet.getCell('M3').value).toBe(400);expect(sheet.getCell('P2').value).toBe(2);expect(w.getWorksheet('Napomene')!.getCell('A5').value).toContain('procenu');
});
