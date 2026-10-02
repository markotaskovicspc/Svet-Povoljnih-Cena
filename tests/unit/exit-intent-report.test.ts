import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { exitIntentReportQuery, type ExitIntentReportRow } from "@/lib/admin/exit-intent-report.server";
import { resolveReportPeriod } from "@/lib/admin/report-period";
import { EXIT_INTENT_CAMPAIGN } from "@/lib/analytics/exit-intent";
const sql = new PGlite();
let next = 0;
async function event(who: string, at: string, exposure: string, stage = "impression", campaign = EXIT_INTENT_CAMPAIGN) {
  await sql.query('INSERT INTO "AnalyticsEvent" VALUES ($1, $2, $3, $4, $5, null)', [String(++next), "EXIT_INTENT", who, at, JSON.stringify({ campaign, event: stage, exposureId: exposure })]);
}
async function order(who: string, at: string, status = "KREIRANO", channel = "WEB", payment?: string) {
  const id = `order-${++next}`;
  await sql.query('INSERT INTO "Order" VALUES ($1,$2,$3,$4,1100,100,50,100)', [id, at, status, channel]);
  // Duplicate completion events must not duplicate the order or its value.
  for (let n = 0; n < 2; n++) await sql.query('INSERT INTO "AnalyticsEvent" VALUES ($1,$2,$3,$4,null,$5)', [String(++next), "CHECKOUT_COMPLETED", who, at, id]);
  if (payment) await sql.query('INSERT INTO "Payment" VALUES ($1,$2)', [id, payment]);
}
async function report(from = "2026-10-01", to = "2026-10-02") {
  const query = exitIntentReportQuery(resolveReportPeriod({ range: "custom", from, to }), new Date("2026-11-01"));
  return (await sql.query<ExitIntentReportRow>(query.text, query.values)).rows;
}
beforeAll(async () => {
  // Isolated in-memory PostgreSQL: no application DB or customer data is accessed.
  await sql.exec(`CREATE TABLE "AnalyticsEvent" (id text PRIMARY KEY, type text, "anonymousId" text, "occurredAt" timestamp, metadata jsonb, "orderId" text);
    CREATE TABLE "Order" (id text PRIMARY KEY, "createdAt" timestamp, status text, channel text, total numeric, shipping numeric, "assemblyTotal" numeric, "firstPurchaseDiscount" numeric);
    CREATE TABLE "Payment" ("orderId" text, status text);`);
  await event("active", "2026-10-01T08:00:00Z", "a");
  await event("active", "2026-10-01T08:00:05Z", "a", "register_clicked");
  await event("active", "2026-10-01T08:00:06Z", "a", "register_clicked");
  await event("active", "2026-10-01T08:01:00Z", "a", "retained");
  await event("spoof-other-browser", "2026-10-01T08:01:00Z", "a", "shop_clicked");
  await order("active", "2026-10-03T09:00:00Z", "KREIRANO", "WEB", "PAID");
  await event("passive", "2026-10-01T09:00:00Z", "b");
  await event("passive", "2026-10-01T09:00:02Z", "b", "retained");
  await event("passive", "2026-10-01T09:31:00Z", "b", "retained");
  await order("passive", "2026-10-02T09:00:00Z", "ISPORUCENO");
  for (const [who, status, channel, payment] of [
    ["cancelled", "OTKAZANO", "WEB"], ["returned", "VRACENO", "WEB"],
    ["refunded", "KREIRANO", "WEB", "REFUNDED"], ["marketplace", "KREIRANO", "ANANAS"],
  ]) {
    await event(who!, "2026-10-01T09:00:00Z", who!);
    await order(who!, "2026-10-02T09:00:00Z", status, channel, payment);
  }
  await event("boundary", "2026-10-01T09:00:00Z", "boundary");
  await order("boundary", "2026-10-08T09:00:00Z");
  await event("before", "2026-10-01T09:00:00Z", "before");
  await order("before", "2026-10-01T08:59:00Z");
  await order("different-browser", "2026-10-02T10:00:00Z");
  await event("repeat", "2026-10-01T09:00:00Z", "repeat1");
  await event("repeat", "2026-10-02T09:00:00Z", "repeat2");
  await order("repeat", "2026-10-02T10:00:00Z");
  await event("later", "2026-10-01T09:00:00Z", "later1");
  await event("later", "2026-10-03T09:00:00Z", "later2");
  await order("later", "2026-10-03T10:00:00Z");
  await event("midnight", "2026-09-30T22:05:00Z", "midnight");
  await event("old-campaign", "2026-10-01T09:00:00Z", "old", "impression", "old-version");
}, 30_000);
afterAll(async () => { await sql.close(); });
it("counts unique people and server orders once, with value excluding delivery and assembly", async () => {
  const rows = await report();
  expect(rows.find(row => row.day === null)).toMatchObject({ visitors: 11, impressions: 12, clicked: 1, registered: 1, retained: 1, shopClicked: 0, buyers: 3, orders: 3, discountedOrders: 3, paidOrders: 2, orderValue: 2850 });
});
it("attributes to the last exposure, including exposures after the selected period", async () => {
  const rows = await report();
  expect(rows.find(row => row.day === "2026-10-01")).toMatchObject({ buyers: 2, orders: 2 });
  expect(rows.find(row => row.day === "2026-10-02")).toMatchObject({ buyers: 1, orders: 1 });
  expect((await report("2026-10-03", "2026-10-03")).find(row => row.day === null)).toMatchObject({ buyers: 1, orders: 1 });
});
it("uses Belgrade dates and returns a zero total for an empty cohort", async () => {
  expect((await report()).find(row => row.day === "2026-10-01")?.impressions).toBe(11);
  expect((await report("2026-12-01", "2026-12-01")).find(row => row.day === null)).toMatchObject({ impressions: 0, visitors: 0, orders: 0, orderValue: 0 });
});
