import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { analyticsFunnelSummaryQuery } from "@/lib/admin/analytics-report.server";
import { buildDashboardDataQuery } from "@/lib/admin/dashboard-data";
import { resolveReportPeriod } from "@/lib/admin/report-period";
const sql = new PGlite();
const now = new Date("2026-10-13T20:00:00Z");
const period = resolveReportPeriod({ range: "custom", from: "2026-10-01", to: "2026-10-13" }, now);
const input = { now, warehouseId: "", todayPeriod: period, ordersPeriod: period, fiscalPeriod: period, reclamationsPeriod: period, topProductsPeriod: period, analyticsPeriod: period };
async function queryReport() { const q = analyticsFunnelSummaryQuery(period); return (await sql.query(q.text, q.values)).rows[0]; }
beforeAll(async () => { await sql.exec(`
 CREATE TABLE "Order" (id text primary key, channel text, status text, total numeric, "createdAt" timestamp);
 CREATE TABLE "AnalyticsEvent" (id text primary key, type text, "anonymousId" text, "sessionId" text, "orderId" text, value numeric, "occurredAt" timestamp);
 CREATE TABLE "SiteVisitorPresence" ("lastSeenAt" timestamp);
`); }, 30000);
beforeEach(async () => {
 await sql.exec('TRUNCATE "Order", "AnalyticsEvent"');
 for (const [id, status, channel, total] of [["valid", "KREIRANO", "WEB", 1000], ["cancelled", "OTKAZANO", "WEB", 9000], ["returned", "VRACENO", "WEB", 500], ["market", "KREIRANO", "ANANAS", 8000]] as const) {
  await sql.query('INSERT INTO "Order" VALUES ($1,$2,$3,$4,$5)', [id,channel,status,total,"2026-10-13 10:00"]);
  for (const [suffix,type,time] of [["view","PAGE_VIEW","09:00"],["cart","ADD_TO_CART","09:10"],["checkout","CHECKOUT_COMPLETED","10:00"],["duplicate","CHECKOUT_COMPLETED","10:01"]]) {
   await sql.query('INSERT INTO "AnalyticsEvent" VALUES ($1,$2,$3,$3,$4,99999,$5)', [id+suffix,type,id,id,"2026-10-13 "+time]);
  }
 }
});
afterAll(async () => { await sql.close(); });
it("counts real non-cancelled web orders once and uses their current value", async () => {
 expect(await queryReport()).toEqual({ visitors:4, purchasers:2, purchase_value:1500, cart_buyers:4, converted_cart_buyers:2 });
});
it("removes a later cancellation from visit and cart conversion even though checkout events remain", async () => {
 await sql.exec(`UPDATE "Order" SET status='OTKAZANO' WHERE id='valid'`);
 expect(await queryReport()).toMatchObject({ purchasers:1, purchase_value:500, converted_cart_buyers:1 });
});
it("uses identical funnel totals on the dashboard and conversion report", async () => {
 const q = buildDashboardDataQuery(input, "analytics");
 const result = (await sql.query<{ conversionRows: unknown[] }>(q.text,q.values)).rows[0];
 expect(result.conversionRows).toEqual([await queryReport()]);
});
