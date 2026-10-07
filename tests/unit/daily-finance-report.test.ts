import {expect,it} from 'vitest';
import {combineDailyFinance,summarizeDailyFinanceReport} from '@/lib/admin/daily-finance-report';
const base=[{day:'2026-10-05',proformaCount:1,proformaGross:1200,fiscalSaleCount:1,fiscalSaleGross:1400,fiscalRefundCount:1,fiscalRefundGross:200,fiscalNetGross:1200}];
const issuedAt=new Date('2026-10-05T21:00:00Z');
const lines=[{issuedAt,kind:'SALE',sku:'A',name:'Stolica',qty:2,unitCogs:300,currentCogs:500},{issuedAt,kind:'REFUND',sku:'A',name:'Stolica',qty:1,unitCogs:null,originalUnitCogs:300,currentCogs:500},{issuedAt,kind:'SALE',sku:'DOSTAVA',name:'Dostava',qty:1,unitCogs:null,currentCogs:90}];
const docs=[{issuedAt,kind:'SALE',gross:1200,items:[{sku:'B',name:'Sto',quantity:2,gross:1000},{sku:'DOSTAVA',name:'Dostava',quantity:1,gross:200}]},{issuedAt,kind:'REFUND',gross:500,items:[{sku:'B',name:'Sto',quantity:1,gross:500}]}];
it('combines document counts and full gross without multiplying by fiscal lines; reverses COGS on refund day',()=>{
 const [row]=combineDailyFinance(base,lines,docs,new Map([['B',200]]));
 expect(row).toMatchObject({fiscalSaleCount:2,fiscalRefundCount:2,fiscalSaleGross:2600,fiscalRefundGross:700,fiscalNetGross:1900,spcNetGross:1200,ananasNetGross:700,fiscalSaleCogs:1000,fiscalRefundCogs:500,fiscalNetCogs:500,spcNetCogs:300,ananasNetCogs:200,estimatedCogsQty:3,missingCogsQty:0});
 expect(summarizeDailyFinanceReport([row]).fiscalNetCogs).toBe(500);
});
it('filters SPC and Ananas consistently, keeping proformas SPC-only',()=>{
 expect(combineDailyFinance(base,lines,docs,new Map([['B',200]]),'SPC')[0]).toMatchObject({proformaCount:1,fiscalNetGross:1200,fiscalNetCogs:300,ananasNetGross:0,estimatedCogsQty:0});
 expect(combineDailyFinance(base,lines,docs,new Map([['B',200]]),'ANANAS')[0]).toMatchObject({proformaCount:0,proformaGross:0,fiscalNetGross:700,fiscalNetCogs:200,spcNetGross:0,spcNetCogs:0});
});
it('marks current costs as estimates, retains real zero costs, and counts missing merchandise instead of treating it as known zero',()=>{
 const legacy=[{issuedAt,kind:'SALE',sku:'X',name:'Fen',qty:2,unitCogs:null,currentCogs:10.25},{issuedAt,kind:'SALE',sku:'Y',name:'Pegla',qty:3,unitCogs:null,currentCogs:null},{issuedAt,kind:'SALE',sku:'Z',name:'Poklon',qty:1,unitCogs:0,currentCogs:50}];
 expect(combineDailyFinance(base,legacy,[],new Map())[0]).toMatchObject({fiscalSaleCogs:20.5,fiscalNetCogs:20.5,estimatedCogsQty:2,missingCogsQty:3});
});
it('buckets COGS and Ananas by Belgrade day, and never deducts lifetime refundedQty from earlier sales',()=>{
 const days=[...base,{...base[0],day:'2026-10-06'}];
 const dated={issuedAt:new Date('2026-10-05T22:30:00Z'),kind:'REFUND',sku:'A',name:'Stolica',qty:1,unitCogs:300,currentCogs:500};
 const rows=combineDailyFinance(days,[lines[0],dated],[],new Map());
 expect(rows[0].fiscalNetCogs).toBe(600);expect(rows[1].fiscalNetCogs).toBe(-300);
});
