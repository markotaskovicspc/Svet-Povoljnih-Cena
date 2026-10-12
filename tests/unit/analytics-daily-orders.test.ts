import { PGlite } from "@electric-sql/pglite";
import { type Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: mocks.query } }));
import { getDailyVisitsReport } from "@/lib/admin/analytics-report.server";
import { resolveReportPeriod } from "@/lib/admin/report-period";

const sql = new PGlite();
beforeAll(async () => {
  await sql.exec(`
    CREATE TABLE "AnalyticsEvent" (
      id text, type text, "occurredAt" timestamp, "sessionId" text, "anonymousId" text
    );
    CREATE TABLE "Order" (
      id text, "createdAt" timestamp, channel text, status text, total numeric(12, 2)
    );
  `);
  mocks.query.mockImplementation(async (query: Prisma.Sql) =>
    (await sql.query(query.text, query.values)).rows,
  );
}, 30_000);
beforeEach(async () => { await sql.exec('TRUNCATE "AnalyticsEvent", "Order"'); });
afterAll(async () => { await sql.close(); });

async function order(id: string, at: string, total: number, status = "KREIRANO", channel = "WEB") {
  await sql.query('INSERT INTO "Order" VALUES ($1, $2, $3, $4, $5)', [id, at, channel, status, total]);
}

it("sums web orders once independently of visits, excluding cancelled, returned and other channels", async () => {
  await sql.exec(`INSERT INTO "AnalyticsEvent" VALUES
    ('view-1', 'PAGE_VIEW', '2026-10-10 10:00:00', 'same-session', 'visitor'),
    ('view-2', 'PAGE_VIEW', '2026-10-10 11:00:00', 'same-session', 'visitor'),
    ('view-3', 'PAGE_VIEW', '2026-10-10 12:00:00', null, 'other-visitor');`);
  await order("first", "2026-10-10T10:00:00Z", 1000.25);
  await order("second", "2026-10-10T11:00:00Z", 2000.50, "ISPORUCENO");
  await order("cancelled", "2026-10-10T10:00:00Z", 8000, "OTKAZANO");
  await order("returned", "2026-10-10T10:00:00Z", 9000, "VRACENO");
  await order("marketplace", "2026-10-10T10:00:00Z", 10000, "KREIRANO", "ANANAS");
  await order("without-analytics", "2026-10-11T10:00:00Z", 750.75);

  expect(await getDailyVisitsReport(resolveReportPeriod({ range: "custom", from: "2026-10-09", to: "2026-10-11" }))).toEqual([
    { day: "2026-10-11", visits: 0, pageViews: 0, orderValue: 750.75 },
    { day: "2026-10-10", visits: 2, pageViews: 3, orderValue: 3000.75 },
    { day: "2026-10-09", visits: 0, pageViews: 0, orderValue: 0 },
  ]);
});

it.each([
  ["2026-03-29", 23],
  ["2026-10-25", 25],
])("uses Belgrade midnight boundaries on the %s clock-change day", async (day, hours) => {
  const period = resolveReportPeriod({ range: "custom", from: day, to: day });
  expect(period.endExclusive.getTime() - period.start.getTime()).toBe(hours * 3_600_000);
  await order("before", new Date(period.start.getTime() - 1).toISOString(), 9000);
  await order("start", period.start.toISOString(), 100.25);
  await order("last", new Date(period.endExclusive.getTime() - 1).toISOString(), 200.50);
  await order("after", period.endExclusive.toISOString(), 9000);

  expect(await getDailyVisitsReport(period)).toEqual([
    { day, visits: 0, pageViews: 0, orderValue: 300.75 },
  ]);
});
