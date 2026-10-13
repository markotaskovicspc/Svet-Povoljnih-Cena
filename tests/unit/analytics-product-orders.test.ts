import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import {
  pageConversionReportQuery, pagePurchaseOrdersQuery,
  type AnalyticsGranularity, type PagePurchaseOrderRow,
} from "@/lib/admin/analytics-report.server";
import { resolveReportPeriod } from "@/lib/admin/report-period";

const sql = new PGlite();
const period = resolveReportPeriod({ range: "custom", from: "2026-10-01", to: "2026-10-02" });
type Row = { bucket: string; path: string; page_views: number; visits: number; purchases: number; purchase_value: number };
async function report(group: AnalyticsGranularity = "period") {
  const query = pageConversionReportQuery(period, group);
  return (await sql.query<Row>(query.text, query.values)).rows;
}
async function orders(path: string, bucket = "2026-10-01", group: AnalyticsGranularity = "period", page = 1) {
  const query = pagePurchaseOrdersQuery(period, group, path, bucket, page);
  return (await sql.query<PagePurchaseOrderRow>(query.text, query.values)).rows;
}

beforeAll(async () => {
  await sql.exec(`
    CREATE TABLE "AnalyticsEvent" (id text PRIMARY KEY, type text, "anonymousId" text, "sessionId" text, path text, "orderId" text, "occurredAt" timestamp);
    CREATE TABLE "Order" (id text PRIMARY KEY, number text, status text, channel text, total numeric, "createdAt" timestamp);
    CREATE TABLE "Product" (id text PRIMARY KEY, slug text);
    CREATE TABLE "OrderItem" ("orderId" text, "productId" text, qty int, "unitPriceSale" numeric);
    INSERT INTO "Product" VALUES ('chair', 'stolica'), ('lamp', 'lampa'), ('unbought', 'nekupljen');
    INSERT INTO "Order" VALUES
      ('one', 'WEB-1', 'KREIRANO', 'WEB', 4500, '2026-10-01 08:00'),
      ('two', 'WEB-2', 'ISPORUCENO', 'WEB', 900, '2026-10-02 08:00'),
      ('cancelled', 'WEB-C', 'OTKAZANO', 'WEB', 100, '2026-10-01 08:00'),
      ('returned', 'WEB-R', 'VRACENO', 'WEB', 100, '2026-10-01 08:00'),
      ('marketplace', 'ANA-1', 'KREIRANO', 'ANANAS', 100, '2026-10-01 08:00'),
      ('outside', 'WEB-OUT', 'KREIRANO', 'WEB', 100, '2026-10-02 22:00'),
      ('midnight', 'WEB-M', 'KREIRANO', 'WEB', 100, '2026-09-30 22:05');
    INSERT INTO "OrderItem" VALUES
      ('one', 'chair', 2, 1000), ('one', 'chair', 1, 1000), ('one', 'lamp', 1, 500),
      ('two', 'chair', 1, 900), ('midnight', 'lamp', 1, 100),
      ('cancelled', 'chair', 1, 100), ('returned', 'chair', 1, 100),
      ('marketplace', 'chair', 1, 100), ('outside', 'chair', 1, 100);
    INSERT INTO "AnalyticsEvent" VALUES
      ('v1', 'PAGE_VIEW', 'buyer1', 's1', '/p/stolica', null, '2026-10-01 07:00'),
      ('v2', 'PAGE_VIEW', 'buyer1', 's1', '/p/stolica/?utm_source=ad', null, '2026-10-01 07:01'),
      ('v3', 'PAGE_VIEW', 'buyer1', 's1', '/checkout/podaci', null, '2026-10-01 07:59'),
      ('c1', 'CHECKOUT_COMPLETED', 'buyer1', 's1', null, 'one', '2026-10-01 08:00'),
      ('c2', 'CHECKOUT_COMPLETED', 'buyer1', 's1', null, 'one', '2026-10-01 08:01');
  `);
}, 30_000);
afterAll(async () => { await sql.close(); });

it("counts each real web order once per product, including orders without analytics consent", async () => {
  const rows = await report();
  expect(rows.find(row => row.path === "/p/stolica")).toMatchObject({ page_views: 2, visits: 1, purchases: 3, purchase_value: 4000 });
  expect(rows.find(row => row.path === "/p/lampa")).toMatchObject({ page_views: 0, visits: 0, purchases: 2, purchase_value: 600 });
  expect(rows.filter(row => row.path.startsWith("/p/"))).toHaveLength(2);
});

it("drilldown has the same orders and value as the summary and aggregates duplicate product lines", async () => {
  const rows = await orders("/p/stolica");
  expect(rows.map(row => row.number)).toEqual(["WEB-2", "WEB-R", "WEB-1"]);
  expect(rows.find(row => row.id === "one")?.quantity).toBe(3);
  expect(rows.every(row => row.totalCount === 3)).toBe(true);
  const summary = (await report()).find(row => row.path === "/p/stolica")!;
  expect(rows).toHaveLength(summary.purchases);
  expect(rows.reduce((sum, row) => sum + row.value, 0)).toBe(summary.purchase_value);
});

it("keeps non-product last-page attribution without multiplying checkout completions", async () => {
  expect((await report()).find(row => row.path === "/checkout/podaci")).toMatchObject({ purchases: 1, purchase_value: 4500 });
  expect(await orders("/checkout/podaci")).toMatchObject([{ id: "one", quantity: null, value: 4500, totalCount: 1 }]);
  // A last-viewed product that is absent from the order is not reported as purchased.
  await sql.exec(`INSERT INTO "AnalyticsEvent" VALUES ('v4', 'PAGE_VIEW', 'buyer1', 's1', '/p/nekupljen', null, '2026-10-01 07:59:30')`);
  expect((await report()).find(row => row.path === "/p/nekupljen")).toMatchObject({ purchases: 0, purchase_value: 0 });
  expect(await orders("/p/nekupljen")).toEqual([]);
  await sql.exec(`DELETE FROM "AnalyticsEvent" WHERE id = 'v4'`);
});

it("uses order creation date in Belgrade and keeps day/week/month drilldowns in the selected bucket", async () => {
  const days = await report("day");
  expect(days.find(row => row.path === "/p/lampa" && row.bucket === "2026-10-01")?.purchases).toBe(2);
  expect((await orders("/p/stolica", "2026-10-02", "day")).map(row => row.id)).toEqual(["two"]);
  expect(await orders("/p/stolica", "2026-10-03", "day")).toEqual([]);
  expect((await orders("/p/stolica", "2026-09-28", "week"))).toHaveLength(3);
  expect((await orders("/p/stolica", "2026-10-01", "month"))).toHaveLength(3);
});

it("paginates without losing the total and treats paths as query parameters", async () => {
  await sql.exec(`INSERT INTO "Order" SELECT 'page-' || n, 'PAGE-' || n, 'KREIRANO', 'WEB', 10, '2026-10-01 12:00'::timestamp FROM generate_series(1, 51) n;
    INSERT INTO "OrderItem" SELECT 'page-' || n, 'chair', 1, 10 FROM generate_series(1, 51) n;`);
  const first = await orders("/p/stolica");
  const second = await orders("/p/stolica", "2026-10-01", "period", 2);
  expect(first).toHaveLength(50);
  expect(second).toHaveLength(4);
  expect(first[0].totalCount).toBe(54);
  expect(new Set([...first, ...second].map(row => row.id)).size).toBe(54);
  expect(await orders("/p/stolica' OR 1=1 --")).toEqual([]);
});
