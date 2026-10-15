import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { Prisma, OrderStatus, ShipmentStatus, ShipmentPurpose } from "@prisma/client";
import { dashboardReturnsQuery } from "@/lib/admin/dashboard-returns";
import { resolveReportPeriod } from "@/lib/admin/report-period";
const sql = new PGlite();
const now = new Date("2026-10-15T12:00:00Z");
beforeAll(async () => { await sql.exec(`
 CREATE TYPE order_status AS ENUM (${Object.values(OrderStatus).map(value => `'${value}'`).join(",")});
 CREATE TYPE shipment_status AS ENUM (${Object.values(ShipmentStatus).map(value => `'${value}'`).join(",")});
 CREATE TYPE shipment_purpose AS ENUM (${Object.values(ShipmentPurpose).map(value => `'${value}'`).join(",")});
 CREATE TABLE "Order" (id text PRIMARY KEY, status order_status);
 CREATE TABLE "OrderItem" ("orderId" text, "warehouseId" text);
 CREATE TABLE "Shipment" (id text PRIMARY KEY, "orderId" text, purpose shipment_purpose, status shipment_status, "shippedAt" timestamp);
 CREATE TABLE "ShipmentEvent" ("shipmentId" text, status shipment_status, "occurredAt" timestamp);
 CREATE TABLE "PickupBatchLine" ("orderId" text, purpose shipment_purpose, "courierPickedUpAt" timestamp);
 CREATE TABLE "OrderStatusEvent" ("orderId" text, status order_status, "createdAt" timestamp);
 CREATE TABLE "StockMovement" ("orderId" text, kind text, qty int);
 CREATE TABLE "ReturnParcelArrival" ("shipmentId" text);
 `); }, 30000);
afterAll(async () => { await sql.close(); });
beforeEach(async () => { await sql.exec('TRUNCATE "Order", "OrderItem", "Shipment", "ShipmentEvent", "PickupBatchLine", "OrderStatusEvent", "StockMovement", "ReturnParcelArrival"'); });
async function order(id: string, sent: string | null = "2026-10-01T10:00:00Z", status = "ISPORUCENO", warehouse = "DC") {
 await sql.query('INSERT INTO "Order" VALUES ($1,$2)', [id,status]);
 await sql.query('INSERT INTO "OrderItem" VALUES ($1,$2)', [id,warehouse]);
 await shipment(id,id,"ORDER_DELIVERY","DELIVERED",sent);
}
async function shipment(id: string, orderId: string, purpose: string, status: string, sent: string | null = null) {
 await sql.query('INSERT INTO "Shipment" VALUES ($1,$2,$3,$4,$5)', [id,orderId,purpose,status,sent]);
}
async function summary(warehouse = "") {
 const query = Prisma.sql`SELECT ${dashboardReturnsQuery(now, warehouse)} AS summary`;
 return (await sql.query<{ summary: {sent:number;returned:number} }>(query.text,query.values)).rows[0].summary;
}
it("counts each sent order once despite multiple parcels, return events and reclamations", async () => {
 await order("refused");
 await shipment("refused-second","refused","ORDER_DELIVERY","RETURNED","2026-10-02T10:00Z");
 await sql.exec(`INSERT INTO "ShipmentEvent" VALUES ('refused-second','RETURNED','2026-10-10'); INSERT INTO "ReturnParcelArrival" VALUES ('refused-second');`);
 await order("claim");
 await shipment("claim-return","claim","RECLAMATION_RETURN","DELIVERED");
 await shipment("claim-return-2","claim","RECLAMATION_RETURN","DELIVERED");
 await order("clean");
 expect(await summary()).toEqual({sent:3,returned:2});
});
it("does not treat an open claim, a return in transit or a failed reclamation collection as a completed return", async () => {
 await order("open"); await shipment("open-claim","open","RECLAMATION_RETURN","CREATED");
 await order("returning"); await sql.exec(`UPDATE "Shipment" SET status='IN_TRANSIT' WHERE id='returning';`);
 await order("failed"); await shipment("failed-claim","failed","RECLAMATION_RETURN","RETURNED");
 expect(await summary()).toEqual({sent:3,returned:0});
});
it("uses the original dispatch, excludes label-only records and respects the fixed 30-day boundaries", async () => {
 const period = resolveReportPeriod({range:"30d"},now);
 await order("old","2026-08-01T10:00Z"); await shipment("reship","old","ORDER_DELIVERY","RETURNED","2026-10-03T10:00Z");
 await order("label-only",null,"KREIRANO");
 await order("before",new Date(period.start.getTime()-1).toISOString());
 await order("boundary",period.start.toISOString());
 await order("future",new Date(now.getTime()+1000).toISOString());
 expect(await summary()).toEqual({sent:1,returned:0});
});
it("accepts recorded courier handover and dispatched order history without using creation dates", async () => {
 await order("picked",null); await sql.exec(`INSERT INTO "PickupBatchLine" VALUES ('picked','ORDER_DELIVERY','2026-10-04');`);
 await order("event",null); await sql.exec(`INSERT INTO "ShipmentEvent" VALUES ('event','PICKED_UP','2026-10-05');`);
 await order("manual",null,"VRACENO"); await sql.exec(`INSERT INTO "OrderStatusEvent" VALUES ('manual','U_ISPORUCI','2026-10-06');`);
 expect(await summary()).toEqual({sent:3,returned:1});
});
it("includes warehouse arrivals, posted returns and historical returns after later reshipment", async () => {
 await order("arrived"); await shipment("arrived-claim","arrived","RECLAMATION_RETURN","PICKED_UP");
 await sql.exec(`INSERT INTO "ReturnParcelArrival" VALUES ('arrived-claim');`);
 await order("posted"); await sql.exec(`INSERT INTO "StockMovement" VALUES ('posted','REFUND_RETURN',1);`);
 await order("history"); await sql.exec(`INSERT INTO "OrderStatusEvent" VALUES ('history','VRACENO','2026-10-06');`);
 await order("negative"); await sql.exec(`INSERT INTO "StockMovement" VALUES ('negative','REFUND_RETURN',-1);`);
 expect(await summary()).toEqual({sent:4,returned:3});
});
it("filters by the outbound warehouse and returns zero counts for an empty cohort", async () => {
 await order("first",undefined,"VRACENO","DC"); await order("second",undefined,"ISPORUCENO","OTHER");
 expect(await summary("DC")).toEqual({sent:1,returned:1});
 expect(await summary("OTHER")).toEqual({sent:1,returned:0});
 expect(await summary("missing")).toEqual({sent:0,returned:0});
});

it("counts a refused reclamation replacement, while its delivery is not a return to the warehouse", async () => {
 await order("replacement-returned"); await shipment("replacement-r","replacement-returned","RECLAMATION_REPLACEMENT","RETURNED");
 await order("replacement-delivered"); await shipment("replacement-d","replacement-delivered","RECLAMATION_REPLACEMENT","DELIVERED");
 expect(await summary()).toEqual({sent:2,returned:1});
});
