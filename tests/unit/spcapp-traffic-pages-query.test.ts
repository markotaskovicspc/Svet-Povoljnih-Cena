import { PGlite } from '@electric-sql/pglite';
import { expect,it,vi } from 'vitest';
vi.mock('@/lib/db',()=>({db:{}}));
import { trafficPagesQuery } from '@/lib/partners/spcapp/metrics.server';
import {parseExportQuery} from '@/lib/partners/spcapp/contract';
const parse=(search:string)=>parseExportQuery('traffic-pages',new URL(`https://erp.test?${search}`),'secret',new Date('2026-11-02T12:00:00Z'));
it('accepts only day/month granularity, limit up to 1000 (others stay 200) and binds cursors to traffic-pages',()=>{
 for(const g of ['5minute','hour','year'])expect(()=>parse(`from=2026-10-02&to=2026-10-02&granularity=${g}`)).toThrow();
 expect(parse('from=2026-10-01&to=2026-10-31').granularity).toBe('day');
 expect(parse('from=2025-10-01&to=2026-10-31&granularity=month').granularity).toBe('month');
 expect(parse('from=2026-10-01&to=2026-10-31&limit=1000').limit).toBe(1000);
 for(const l of ['0','1001','1.5'])expect(()=>parse(`from=2026-10-01&to=2026-10-31&limit=${l}`)).toThrow();
 expect(()=>parseExportQuery('traffic',new URL('https://erp.test?from=2026-10-01&to=2026-10-31&limit=201'),'secret')).toThrow();
 const cursor=parse('from=2026-10-01&to=2026-10-31').nextCursor('x');
 expect(()=>parseExportQuery('traffic',new URL(`https://erp.test?from=2026-10-01&to=2026-10-31&cursor=${cursor}`),'secret')).toThrow();
});
it('executes real SQL: normalizes paths, classifies page types, resolves products and paginates by id',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`CREATE TABLE "AnalyticsEvent" (id text,type text,"occurredAt" timestamp,"anonymousId" text,"sessionId" text,path text,"productId" text);
 CREATE TABLE "Product" (id text,sku text,slug text);
 INSERT INTO "Product" VALUES ('p1','SKU-1','sto'),('p2','SKU-2','stolica'),('p3','SKU-3','lampa');
 INSERT INTO "AnalyticsEvent" VALUES
  ('1','PAGE_VIEW','2026-10-01 22:30:00','a','s1','/p/sto?utm=x','p1'),
  ('2','PAGE_VIEW','2026-10-02 10:00:00','b','s2','/p/sto/#top',NULL),
  ('3','PAGE_VIEW','2026-10-02 10:05:00','b',NULL,'/p/sto','p1'),
  ('4','PAGE_VIEW','2026-10-02 10:06:00','c','s4','/p/sto','p2'),
  ('5','PAGE_VIEW','2026-10-02 11:00:00','a','s1','/p/stolica',NULL),
  ('6','PAGE_VIEW','2026-10-02 11:00:00','a','s1','/',NULL),
  ('7','PAGE_VIEW','2026-10-02 11:00:00','a','s1','/?q=1',NULL),
  ('8','PAGE_VIEW','2026-10-02 11:00:00','a','s1','/k/dnevna-soba/stolovi/',NULL),
  ('9','PAGE_VIEW','2026-10-02 11:00:00','a','s1','/korpa',NULL),
  ('10','PAGE_VIEW','2026-10-02 11:00:00','a','s1','/checkout/podaci',NULL),
  ('11','PAGE_VIEW','2026-10-02 11:00:00','a','s1','/pretraga?q=sto',NULL),
  ('12','PAGE_VIEW','2026-10-02 11:00:00','a','s1','/o-nama',NULL),
  ('13','PAGE_VIEW','2026-10-02 11:00:00','a','s1',NULL,NULL),
  ('14','PAGE_VIEW','2026-10-02 11:00:00','a','s1','',NULL),
  ('15','PAGE_VIEW','2026-10-02 11:00:00','a','s1','?x=1',NULL),
  ('16','ADD_TO_CART','2026-10-02 11:00:00','a','s1','/p/lampa','p3'),
  ('17','PAGE_VIEW','2026-10-03 11:00:00','a','s1','/p/sto',NULL);`);
 const q=parse('from=2026-10-02&to=2026-10-02');
 let query=trafficPagesQuery(q);
 const rows=(await db.query<Record<string,unknown>>(query.text,query.values)).rows;
 expect(rows.map(r=>r.id)).toEqual(['2026-10-02T00:00:00|/','2026-10-02T00:00:00|/checkout/podaci','2026-10-02T00:00:00|/k/dnevna-soba/stolovi','2026-10-02T00:00:00|/korpa','2026-10-02T00:00:00|/o-nama','2026-10-02T00:00:00|/p/sto','2026-10-02T00:00:00|/p/stolica','2026-10-02T00:00:00|/pretraga']);
 const byPath=Object.fromEntries(rows.map(r=>[r.path,r]));
 expect(byPath['/p/sto']).toEqual({id:'2026-10-02T00:00:00|/p/sto',bucketLocal:'2026-10-02T00:00:00',timezone:'Europe/Belgrade',path:'/p/sto',pageType:'product',pageViews:4,visits:4,uniqueVisitors:3,productId:'p1',sku:'SKU-1'});
 expect(byPath['/p/stolica']).toMatchObject({pageType:'product',productId:'p2',sku:'SKU-2'});
 expect(byPath['/']).toMatchObject({pageType:'home',pageViews:2,visits:1,uniqueVisitors:1,productId:null,sku:null});
 expect(Object.fromEntries(rows.map(r=>[r.path,r.pageType]))).toMatchObject({'/k/dnevna-soba/stolovi':'category','/korpa':'cart','/checkout/podaci':'checkout','/pretraga':'search','/o-nama':'other'});
 for(const r of rows)expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['anonymousId']));
 query=trafficPagesQuery({...q,limit:2,after:'2026-10-02T00:00:00|/korpa'});
 expect((await db.query<{id:string}>(query.text,query.values)).rows.map(r=>r.id)).toEqual(['2026-10-02T00:00:00|/o-nama','2026-10-02T00:00:00|/p/sto','2026-10-02T00:00:00|/p/stolica']);
 query=trafficPagesQuery(parse('from=2026-10-01&to=2026-10-31&granularity=month'));
 const month=(await db.query<Record<string,unknown>>(query.text,query.values)).rows;
 expect(month.find(r=>r.path==='/p/sto')).toMatchObject({id:'2026-10-01T00:00:00|/p/sto',pageViews:5,uniqueVisitors:3});
 }finally{await db.close();}
},30000);
