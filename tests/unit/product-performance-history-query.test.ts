import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { productPerformanceQuery } from '@/lib/admin/product-performance.server';
import { calculateProductPerformance, type PerformanceInput } from '@/lib/admin/product-performance';
import { resolveReportPeriod } from '@/lib/admin/report-period';
vi.mock('@/lib/db',()=>({db:{}}));
it('executes historical valuation SQL with inclusive Serbian dates, booked costs and foreign legacy receipts',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`
 CREATE TABLE "Product" (id text,sku text,name text,stock int,cogs numeric);
 CREATE TABLE "Order" (id text,channel text);
 CREATE TABLE "FiscalDocument" (id text,"orderId" text,"issuedAt" timestamp,status text,kind text);
 CREATE TABLE "FiscalDocumentLine" (id text,"productId" text,"fiscalDocumentId" text,"originalSaleLineId" text,qty int,"totalGross" numeric,"serviceGross" numeric,"unitCogs" numeric);
 CREATE TABLE "StockMovement" (id text,"productId" text,"createdAt" timestamp,qty int,"balanceAfterTotal" int,kind text,"idempotencyKey" text);
 CREATE TABLE "PurchasePrice" (id text,"productId" text,sku text,"validFrom" timestamp,"validTo" timestamp,price numeric,currency text,"createdAt" timestamp);
 CREATE TABLE "PurchaseOrder" (id text,"cogsBookedAt" timestamp,"cogsBookingSnapshot" jsonb,"exchangeRate" numeric);
 CREATE TABLE "PurchaseOrderItem" (id text,"purchaseOrderId" text,"productId" text,qty int,"purchasePrice" numeric,"customsRate" numeric,"freightAllocated" numeric,"additionalCostAllocated" numeric);
 CREATE TABLE "InboundInvoice" ("purchaseOrderId" text,status text);
 INSERT INTO "Product" VALUES ('p','P','Prices',10,999),('b','B','Booked',20,999),('l','L','Legacy',10,999);
 INSERT INTO "PurchasePrice" VALUES
 ('p1','p','P','2026-09-01','2026-10-01',100,'RSD','2026-09-01'),
 ('p2','p','P','2026-10-02',NULL,200,'RSD','2026-09-01'),
 ('b1','b','B','2026-09-01',NULL,100,'RSD','2026-09-01'),
 ('l1','l','L','2026-09-01',NULL,200,'EUR','2026-09-01');
 INSERT INTO "StockMovement" VALUES
 ('pbase','p','2026-09-01',10,10,'INITIAL',NULL),
 ('bbase','b','2026-09-01',10,10,'INITIAL',NULL),
 ('lbase','l','2026-09-01',0,0,'INITIAL',NULL),
 ('br','b','2026-10-01 22:00:00',10,20,'PURCHASE_RECEIPT','purchase-order:bpo:receive:bi'),
 ('lr','l','2026-10-01 22:00:00',10,10,'PURCHASE_RECEIPT','purchase-order:lpo:receive:li');
 INSERT INTO "PurchaseOrder" VALUES
 ('bpo','2026-10-01 22:00:00','{"version":1,"products":[{"productId":"b","sku":"B","stock":10,"cogs":100}]}',2),
 ('lpo',NULL,NULL,2);
 INSERT INTO "PurchaseOrderItem" VALUES
 ('bi','bpo','b',10,200,10,200,100),('li','lpo','l',10,200,10,200,100);
 INSERT INTO "InboundInvoice" VALUES ('bpo','POSTED');
 INSERT INTO "Order" VALUES ('o','WEB');
 INSERT INTO "FiscalDocument" VALUES ('sale','o','2026-10-02 08:00:00','ISSUED','SALE');
 INSERT INTO "FiscalDocumentLine" VALUES ('line','p','sale',NULL,2,600,0,NULL);
 `);
 const period=resolveReportPeriod({range:'custom',from:'2026-10-01',to:'2026-10-02'}),now=new Date('2026-10-03T12:00:00Z');
 const query=productPerformanceQuery(period,now);
 const rows=(await db.query<PerformanceInput>(query.text,query.values)).rows;
 const products=Object.fromEntries(rows.map(row=>[row.sku,calculateProductPerformance(row,period,now)]));
 expect(products.P).toMatchObject({averageStockValue:1500,cogs:400,valuationBasis:'purchase-prices'});
 expect(products.B).toMatchObject({averageStockValue:3350,valuationBasis:'mixed',completeCostHistory:true});
 expect(products.L).toMatchObject({averageStockValue:2350,valuationBasis:'booking',completeCostHistory:true});
 await db.exec(`
 INSERT INTO "Product" VALUES ('r','R','Refund',10,999);
 INSERT INTO "StockMovement" VALUES ('rbase','r','2026-09-01',10,10,'INITIAL',NULL);
 INSERT INTO "PurchasePrice" VALUES ('r1','r','R','2026-09-01','2026-09-30',100,'RSD','2026-09-01'),('r2','r','R','2026-10-01',NULL,200,'RSD','2026-09-01');
 INSERT INTO "FiscalDocument" VALUES ('original','o','2026-09-10 08:00:00','ISSUED','SALE'),('refund','o','2026-10-02 08:00:00','ISSUED','REFUND');
 INSERT INTO "FiscalDocumentLine" VALUES ('original-line','r','original',NULL,2,600,0,NULL),('refund-line','r','refund','original-line',2,600,0,NULL);
 `);
 const refundRows=(await db.query<PerformanceInput>(query.text,query.values)).rows;
 expect(calculateProductPerformance(refundRows.find(row=>row.sku==='R')!,period,now)).toMatchObject({cogs:-200,averageStockValue:2000});
 await db.exec(`UPDATE "PurchasePrice" SET "validTo"='2026-10-24' WHERE id='p2';
 INSERT INTO "PurchasePrice" VALUES ('dst','p','P','2026-10-25','2026-10-25',300,'RSD','2026-09-01');`);
 const dst=resolveReportPeriod({range:'custom',from:'2026-10-25',to:'2026-10-25'});
 const dstQuery=productPerformanceQuery(dst,new Date('2026-10-27T00:00:00Z'));
 const dstRow=(await db.query<PerformanceInput>(dstQuery.text,dstQuery.values)).rows.find(row=>row.sku==='P')!;
 expect(calculateProductPerformance(dstRow,dst,new Date('2026-10-27T00:00:00Z')).averageStockValue).toBe(3000);
 // Today's product.cogs=999 never enters any historical denominator.
 expect(rows.find(row=>row.sku==='B')?.costEvents.filter(e=>e.source==='receipt')).toHaveLength(0);
 } finally { await db.close(); }
},30000);
