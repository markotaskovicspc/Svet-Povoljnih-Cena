import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { buildDashboardDataQuery } from "@/lib/admin/dashboard-data";
import { getReportDayPeriods, resolveReportPeriod } from "@/lib/admin/report-period";

const sql = new PGlite();
beforeAll(async () => {
  await sql.exec(`CREATE TABLE "AnalyticsEvent" (
    type text, "occurredAt" timestamp, "sessionId" text, "anonymousId" text,
    "orderId" text, value numeric
  ); CREATE INDEX ON "AnalyticsEvent" (type, "occurredAt");`);
}, 30_000);
afterAll(async () => { await sql.close(); });

it.each([
  "2026-03-29T21:59:59Z", // 23-hour day
  "2026-10-25T22:59:59Z", // 25-hour day
  "2026-09-19T21:59:59Z", // before Belgrade midnight
  "2026-09-19T22:00:01Z", // after Belgrade midnight
])("preserves visit counts, session deduplication and empty days at %s", async (instant) => {
  await sql.exec('TRUNCATE "AnalyticsEvent"');
  const now = new Date(instant);
  const today = resolveReportPeriod({ range: "today" }, now);
  const period = resolveReportPeriod({ range: "30d" }, now);
  const days = getReportDayPeriods(period);
  expect(days).toHaveLength(30);
  expect(days[0].start).toEqual(period.start);
  expect(days[29].endExclusive).toEqual(period.endExclusive);
  for (let i = 1; i < days.length; i++) expect(days[i].start).toEqual(days[i - 1].endExclusive);
  const hours = (days[29].endExclusive.getTime() - days[29].start.getTime()) / 3_600_000;
  if (instant.startsWith("2026-03-29")) expect(hours).toBe(23);
  if (instant.startsWith("2026-10-25")) expect(hours).toBe(25);

  const event = async (at: Date, session: string | null, anonymous: string, type = "PAGE_VIEW") => {
    await sql.query('INSERT INTO "AnalyticsEvent" VALUES ($1,$2,$3,$4,null,null)', [type, at.toISOString(), session, anonymous]);
  };
  await event(new Date(period.start.getTime() - 1), "excluded-before", "before");
  await event(period.start, "session-first", "first");
  await event(today.start, "session-today", "person-a");
  await event(today.start, "session-today", "person-b");
  await event(today.start, null, "anonymous-only");
  await event(now, "session-now", "now");
  await event(period.endExclusive, "excluded-after", "after");
  await event(today.start, "not-a-view", "other", "ADD_TO_CART");

  const query = buildDashboardDataQuery({ now, warehouseId: "", todayPeriod: today,
    ordersPeriod: period, fiscalPeriod: period, reclamationsPeriod: period,
    topProductsPeriod: period, analyticsPeriod: period }, "analytics");
  const revised = (await sql.query<{ visitRows: unknown[] }>(query.text,
    query.values.map((v) => v instanceof Date ? v.toISOString() : v))).rows[0].visitRows[0];
  const original = (await sql.query(`WITH daily AS (
    SELECT ("occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade')::date AS day,
      COUNT(DISTINCT COALESCE("sessionId", "anonymousId"))::double precision AS visits
    FROM "AnalyticsEvent" WHERE type = 'PAGE_VIEW' AND "occurredAt" >= $1::timestamp
      AND "occurredAt" < $2::timestamp GROUP BY 1
  ) SELECT
    (SELECT COUNT(DISTINCT COALESCE("sessionId", "anonymousId")) FROM "AnalyticsEvent"
      WHERE type = 'PAGE_VIEW' AND "occurredAt" >= $3::timestamp)::int AS active_now,
    COALESCE((SELECT visits FROM daily WHERE day = $4::date), 0)::int AS today,
    (COALESCE((SELECT SUM(visits) FROM daily), 0) / 30.0)::double precision AS daily_average_30d`,
    [period.start.toISOString(), period.endExclusive.toISOString(),
      new Date(now.getTime() - 300_000).toISOString(), today.fromInput])).rows[0];
  expect(revised).toEqual(original);
  expect(revised).toMatchObject({ today: 3, daily_average_30d: 4 / 30 });

  await sql.exec('TRUNCATE "AnalyticsEvent"');
  const empty = (await sql.query<{ visitRows: unknown[] }>(query.text,
    query.values.map((v) => v instanceof Date ? v.toISOString() : v))).rows[0];
  expect(empty.visitRows).toEqual([{ active_now: 0, today: 0, daily_average_30d: 0 }]);
});
