import { PGlite } from '@electric-sql/pglite';
import { expect,it,vi } from 'vitest';
vi.mock('@/lib/db',()=>({db:{}}));
import { trafficQuery,customerSummaryQuery } from '@/lib/partners/spcapp/metrics.server';
import {parseExportQuery} from '@/lib/partners/spcapp/contract';
it('executes real SQL for distinct visitors/sessions and lifetime new-vs-returning customer cohorts',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE TABLE "AnalyticsEvent" (type text,"occurredAt" timestamp,"anonymousId" text,"sessionId" text);
 CREATE TABLE "Order" (id text,"customerId" text,"userId" text,"guestEmail" text,"shipPhone" text,"createdAt" timestamp,status text);
 CREATE TABLE "FiscalDocument" ("orderId" text,"issuedAt" timestamp,status text,kind text);
 INSERT INTO "AnalyticsEvent" VALUES ('PAGE_VIEW','2026-10-01 22:30:00','a','s1'),('PAGE_VIEW','2026-10-02 12:00:00','a','s2'),('PAGE_VIEW','2026-10-02 12:05:00','b','s3'),('ADD_TO_CART','2026-10-02 12:10:00','c','s4');
 INSERT INTO "Order" VALUES ('old','a',NULL,NULL,NULL,'2025-01-01','ISPORUCENO'),('new1','b',NULL,NULL,NULL,'2026-10-02 10:00:00','KREIRANO'),('again','a',NULL,NULL,NULL,'2026-10-02 11:00:00','KREIRANO'),('new2','b',NULL,NULL,NULL,'2026-10-02 12:00:00','KREIRANO'),('cancel','c',NULL,NULL,NULL,'2026-10-02 12:00:00','OTKAZANO');
 INSERT INTO "FiscalDocument" VALUES ('old','2026-10-02 10:00:00','ISSUED','SALE'),('again','2026-10-02 12:00:00','ISSUED','SALE'),('new1','2026-10-02 12:00:00','ISSUED','REFUND');`);
 const q=parseExportQuery('traffic',new URL('https://erp.test?from=2026-10-02&to=2026-10-02'),'secret');
 let query=trafficQuery(q);
 const traffic=(await db.query(query.text,query.values)).rows;
 expect(traffic).toEqual([expect.objectContaining({id:'2026-10-02T00:00:00',pageViews:3,uniqueVisitors:2,visits:3})]);
 query=customerSummaryQuery({...q,resource:'customers'});
 expect((await db.query(query.text,query.values)).rows).toEqual([expect.objectContaining({uniqueCustomers:2,newCustomers:1,returningCustomers:1})]);
 query=customerSummaryQuery({...q,resource:'customers',basis:'fiscal'});
 expect((await db.query(query.text,query.values)).rows).toEqual([expect.objectContaining({uniqueCustomers:1,newCustomers:1,returningCustomers:0})]);
 }finally{await db.close();}
},30000);
