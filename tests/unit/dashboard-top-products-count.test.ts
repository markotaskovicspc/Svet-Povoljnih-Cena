import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { buildDashboardDataQuery } from "@/lib/admin/dashboard-data";
import { resolveReportPeriod } from "@/lib/admin/report-period";
const sql = new PGlite();
beforeAll(async () => { await sql.exec(`CREATE TABLE "Order" (id text primary key, status text, "createdAt" timestamp);
 CREATE TABLE "OrderItem" ("orderId" text, sku text, name text, qty int, "unitPriceSale" numeric, "warehouseId" text);
 INSERT INTO "Order" SELECT 'order-'||n,'KREIRANO','2026-10-13 10:00'::timestamp FROM generate_series(1,9) n;
 INSERT INTO "OrderItem" SELECT 'order-'||n,'210019','3u1 BON APPETIT',CASE WHEN n=1 THEN 2 ELSE 1 END,1000,'DC' FROM generate_series(1,9) n;
 INSERT INTO "Order" VALUES ('cancelled','OTKAZANO','2026-10-13 10:00');
 INSERT INTO "OrderItem" VALUES ('cancelled','210019','3u1 BON APPETIT',20,1000,'DC');`); },30000);
afterAll(async()=>{await sql.close();});
it("distinguishes nine non-cancelled orders from ten pieces, including warehouse filtering",async()=>{
 const period=resolveReportPeriod({range:"custom",from:"2026-10-13",to:"2026-10-13"});
 const q=buildDashboardDataQuery({now:new Date("2026-10-13T20:00Z"),warehouseId:"DC",todayPeriod:period,ordersPeriod:period,fiscalPeriod:period,reclamationsPeriod:period,topProductsPeriod:period,analyticsPeriod:period},"operations");
 // Execute the real top-products subquery in an isolated database.
 const end=q.text.indexOf(' AS "topProducts"');
 const start=q.text.lastIndexOf('(SELECT COALESCE(json_agg(result)',end);
 const values: unknown[]=[];
 const statement=q.text.slice(start,end).replace(/\$(\d+)/g,(_,number)=>{values.push(q.values[Number(number)-1]);return `$${values.length}`;});
 const result=await sql.query<{ products: {orders:number;qty:number;value_rsd:number}[] }>(`SELECT ${statement} AS products`,values);
 expect(result.rows[0].products).toMatchObject([{orders:9,qty:10,value_rsd:10000}]);
});
