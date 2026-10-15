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
 CREATE TABLE "OrderItem" ("orderId" text, "warehouseId" text, id text, sku text, qty int DEFAULT 1);
 CREATE TABLE "Shipment" (id text PRIMARY KEY, "orderId" text, purpose shipment_purpose, status shipment_status, "shippedAt" timestamp, "reclamationId" text, "packageCount" int DEFAULT 1, "rawCreateResponse" jsonb);
 CREATE TABLE "ShipmentEvent" ("shipmentId" text, status shipment_status, "occurredAt" timestamp);
 CREATE TABLE "PickupBatchLine" ("orderId" text, purpose shipment_purpose, "courierPickedUpAt" timestamp, "shipmentId" text, "providerParcelNumber" text, "orderItemId" text, "packedQuantity" int DEFAULT 1, "packedItems" jsonb);
 CREATE TABLE "OrderStatusEvent" ("orderId" text, status order_status, "createdAt" timestamp);
 CREATE TABLE "StockMovement" ("orderId" text, kind text, qty int, "orderItemId" text, sku text, "idempotencyKey" text);
 CREATE TABLE "ReturnParcelArrival" ("shipmentId" text, "parcelNumber" text);
 CREATE TABLE "Reclamation" (id text, "orderItemId" text, sku text, quantity int DEFAULT 1, "replacementQty" int);
 `); }, 30000);
afterAll(async () => { await sql.close(); });
beforeEach(async () => { await sql.exec('TRUNCATE "Order", "OrderItem", "Shipment", "ShipmentEvent", "PickupBatchLine", "OrderStatusEvent", "StockMovement", "ReturnParcelArrival", "Reclamation"'); });
async function order(id: string, sent: string | null = "2026-10-01T10:00:00Z", status = "ISPORUCENO", warehouse = "DC") {
 await sql.query('INSERT INTO "Order" VALUES ($1,$2)', [id,status]);
 await sql.query('INSERT INTO "OrderItem" ("orderId","warehouseId",id,sku) VALUES ($1,$2,$1,$1)', [id,warehouse]);
 await shipment(id,id,"ORDER_DELIVERY","DELIVERED",sent);
}
async function shipment(id: string, orderId: string, purpose: string, status: string, sent: string | null = null) {
 if (purpose.startsWith("RECLAMATION")) await sql.query('INSERT INTO "Reclamation" (id,"orderItemId",sku) VALUES ($1,$2,$2)', [id,orderId]);
 await sql.query('INSERT INTO "Shipment" (id,"orderId",purpose,status,"shippedAt") VALUES ($1,$2,$3,$4,$5)', [id,orderId,purpose,status,sent]);
 if (purpose.startsWith("RECLAMATION")) await sql.query('UPDATE "Shipment" SET "reclamationId"=$1 WHERE id=$1', [id]);
}
async function summary(warehouse = "") {
 const query = Prisma.sql`SELECT ${dashboardReturnsQuery(now, warehouse)} AS summary`;
 return (await sql.query<{ summary: {sent:number;returned:number} }>(query.text,query.values)).rows[0].summary;
}
it("caps returned units at the sold quantity despite multiple return events and reclamations", async () => {
 await order("refused");
 await shipment("refused-second","refused","ORDER_DELIVERY","RETURNED","2026-10-02T10:00Z");
 await sql.exec(`INSERT INTO "ShipmentEvent" VALUES ('refused-second','RETURNED','2026-10-10'); INSERT INTO "ReturnParcelArrival" ("shipmentId") VALUES ('refused-second');`);
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
 await order("picked",null); await sql.exec(`INSERT INTO "PickupBatchLine" ("orderId",purpose,"courierPickedUpAt") VALUES ('picked','ORDER_DELIVERY','2026-10-04');`);
 await order("event",null); await sql.exec(`INSERT INTO "ShipmentEvent" VALUES ('event','PICKED_UP','2026-10-05');`);
 await order("manual",null,"VRACENO"); await sql.exec(`INSERT INTO "OrderStatusEvent" VALUES ('manual','U_ISPORUCI','2026-10-06');`);
 expect(await summary()).toEqual({sent:3,returned:1});
});
it("includes warehouse arrivals, posted returns and historical returns after later reshipment", async () => {
 await order("arrived"); await shipment("arrived-claim","arrived","RECLAMATION_RETURN","PICKED_UP");
 await sql.exec(`INSERT INTO "ReturnParcelArrival" ("shipmentId") VALUES ('arrived-claim');`);
 await order("posted"); await sql.exec(`INSERT INTO "StockMovement" ("orderId",kind,qty, "orderItemId") VALUES ('posted','REFUND_RETURN',1,'posted');`);
 await order("history"); await sql.exec(`INSERT INTO "OrderStatusEvent" VALUES ('history','VRACENO','2026-10-06');`);
 await order("negative"); await sql.exec(`INSERT INTO "StockMovement" ("orderId",kind,qty, "orderItemId") VALUES ('negative','REFUND_RETURN',-1,'negative');`);
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

async function quantity(id: string, qty: number) {
 await sql.query('UPDATE "OrderItem" SET qty=$2 WHERE id=$1', [id,qty]);
}
async function parcel(shipmentId: string, code: string, itemId: string, qty: number) {
 await sql.query(`INSERT INTO "PickupBatchLine" ("orderId",purpose,"shipmentId","providerParcelNumber","orderItemId","packedQuantity")
 SELECT "orderId",purpose,id,$2,$3,$4 FROM "Shipment" WHERE id=$1`, [shipmentId,code,itemId,qty]);
}
it("counts one returned unit out of five, rather than all five units in a partially returned order", async () => {
 await order("partial"); await quantity("partial",5);
 await parcel("partial","AAA1","partial",1); await parcel("partial","AAA2","partial",4);
 await sql.exec(`UPDATE "Shipment" SET "packageCount"=2, status='RETURNED' WHERE id='partial';
 INSERT INTO "ReturnParcelArrival" VALUES ('partial','AAA1');
 INSERT INTO "StockMovement" VALUES ('partial','REFUND_RETURN',1,'partial','partial','order-return:SPC:partial:1');`);
 expect(await summary()).toEqual({sent:5,returned:1});
});
it("uses the claim quantity, not the full ordered quantity, without double counting its stock receipt", async () => {
 await order("claim-five"); await quantity("claim-five",5);
 await shipment("one-claim","claim-five","RECLAMATION_RETURN","DELIVERED");
 await sql.exec(`INSERT INTO "StockMovement" VALUES ('claim-five','REFUND_RETURN',1,'claim-five','claim-five','reclamation-return:one-claim');`);
 expect(await summary()).toEqual({sent:5,returned:1});
});
it("adds separate ordinary and reclamation returns while corroborating each receipt only once", async () => {
 await order("both"); await quantity("both",5);
 await parcel("both","A","both",1); await parcel("both","B","both",4);
 await shipment("claim-both","both","RECLAMATION_RETURN","DELIVERED");
 await sql.exec(`INSERT INTO "ReturnParcelArrival" VALUES ('both','A');
 INSERT INTO "StockMovement" VALUES ('both','REFUND_RETURN',1,'both','both','order-return:SPC:both:1'),
 ('both','REFUND_RETURN',1,'both','both','reclamation-return:claim-both');`);
 expect(await summary()).toEqual({sent:5,returned:2});
});
it("attributes a mixed parcel to its own article quantities and applies warehouse filters per article", async () => {
 await order("mixed"); await quantity("mixed",3);
 await sql.exec(`INSERT INTO "OrderItem" VALUES ('mixed','OTHER','other','other',2);`);
 await parcel("mixed","X","mixed",1);
 await sql.query(`UPDATE "PickupBatchLine" SET "packedItems"=$1::jsonb WHERE "shipmentId"='mixed'`,[JSON.stringify([{orderItemId:'mixed',quantity:3},{orderItemId:'other',quantity:2}])]);
 await sql.exec(`INSERT INTO "ReturnParcelArrival" VALUES ('mixed','X');`);
 expect(await summary()).toEqual({sent:5,returned:5});
 expect(await summary('DC')).toEqual({sent:3,returned:3});
 expect(await summary('OTHER')).toEqual({sent:2,returned:2});
});
it("reads legacy parcel contents and normalizes leading zeroes without adding picking snapshots twice", async () => {
 await order("legacy"); await quantity("legacy",5);
 await parcel("legacy","000123","legacy",2);
 await parcel("legacy","000124","legacy",3);
 await sql.query(`UPDATE "Shipment" SET "rawCreateResponse"=$1::jsonb, "packageCount"=2 WHERE id='legacy'`,[JSON.stringify({articleLabels:[{Code:'000123',packedItems:[{orderItemId:'legacy',quantity:2}]},{Code:'000124',packedItems:[{orderItemId:'legacy',quantity:3}]}]})]);
 await sql.exec(`INSERT INTO "ReturnParcelArrival" VALUES ('legacy','123');`);
 expect(await summary()).toEqual({sent:5,returned:2});
});
it("does not guess quantities for a partially arrived multi-parcel claim with no saved contents", async () => {
 await order("unknown"); await quantity("unknown",5);
 await shipment("unknown-claim","unknown","RECLAMATION_RETURN","DELIVERED");
 await sql.exec(`UPDATE "Reclamation" SET quantity=3; UPDATE "Shipment" SET "packageCount"=2 WHERE id='unknown-claim';
 INSERT INTO "ReturnParcelArrival" VALUES ('unknown-claim','A');`);
 expect(await summary()).toEqual({sent:5,returned:0});
});
it("excludes unsent articles when immutable contents identify the dispatched subset", async () => {
 await order("split"); await quantity("split",5);
 await sql.exec(`INSERT INTO "OrderItem" VALUES ('split','DC','unsent','unsent',4);`);
 await parcel("split","sent","split",2);
 await shipment("later","split","ORDER_DELIVERY","CREATED"); await parcel("later","later","unsent",4);
 expect(await summary()).toEqual({sent:2,returned:0});
});
it("counts a zero-delta physical receipt but ignores negative inventory corrections", async () => {
 await order('zero'); await quantity('zero',5);
 await sql.exec(`INSERT INTO "StockMovement" VALUES ('zero','REFUND_RETURN',0,'zero','zero','order-return:SPC:zero:1'),
 ('zero','REFUND_RETURN',-1,'zero','zero','correction');`);
 expect(await summary()).toEqual({sent:5,returned:1});
});
