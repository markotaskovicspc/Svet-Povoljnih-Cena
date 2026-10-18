import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { productPerformanceQuery } from '@/lib/admin/product-performance.server';
import { calculateProductPerformance, type PerformanceInput } from '@/lib/admin/product-performance';
import { type ExportQuery } from './contract';

export function trafficQuery(q: ExportQuery) {
  return Prisma.sql`
    WITH buckets AS (
      SELECT date_trunc(${q.granularity}, "occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade') AS bucket,
        COUNT(*)::int AS "pageViews", COUNT(DISTINCT "anonymousId")::int AS "uniqueVisitors",
        COUNT(DISTINCT COALESCE("sessionId", "anonymousId"))::int AS visits,
        COUNT(*) FILTER (WHERE "sessionId" IS NULL)::int AS "eventsWithoutSession"
      FROM "AnalyticsEvent" WHERE type = 'PAGE_VIEW' AND "occurredAt" >= ${q.period.start} AND "occurredAt" < ${q.period.endExclusive}
      GROUP BY 1
    ) SELECT to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS id,
      to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS "bucketLocal", 'Europe/Belgrade' AS timezone,
      "pageViews", "uniqueVisitors", visits, "eventsWithoutSession"
    FROM buckets WHERE to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS') > ${q.after} ORDER BY bucket LIMIT ${q.limit + 1}
  `;
}
export async function exportTraffic(q: ExportQuery) {
  return db.$queryRaw<{ id: string }[]>(trafficQuery(q));
}
export function customerSummaryQuery(q: ExportQuery) {
  const fiscal = q.basis === 'fiscal';
  const events = fiscal ? Prisma.sql`
    SELECT o."customerId", o."userId", o."guestEmail", o."shipPhone", f."issuedAt" AS at
      FROM "FiscalDocument" f JOIN "Order" o ON o.id = f."orderId" WHERE f.status = 'ISSUED' AND f.kind = 'SALE' AND f."issuedAt" < ${q.period.endExclusive}
  ` : Prisma.sql`
    SELECT o."customerId", o."userId", o."guestEmail", o."shipPhone", o."createdAt" AS at FROM "Order" o
      WHERE o.status <> 'OTKAZANO' AND o."createdAt" < ${q.period.endExclusive}
  `;
  return Prisma.sql`
    WITH events AS (${events}), identities AS (
      SELECT at, COALESCE('customer:' || "customerId", 'user:' || "userId", 'email:' || NULLIF(lower(trim("guestEmail")), ''),
        'phone:' || NULLIF(regexp_replace("shipPhone", '[^0-9+]', '', 'g'), '')) AS identity FROM events
    ), first_seen AS (SELECT identity, MIN(at) AS at FROM identities WHERE identity IS NOT NULL GROUP BY identity),
    activity AS (
      SELECT date_trunc(${q.granularity}, e.at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade') AS bucket,
        e.identity, first_seen.at AS first_at FROM identities e LEFT JOIN first_seen ON first_seen.identity = e.identity
        WHERE e.at >= ${q.period.start} AND e.at < ${q.period.endExclusive}
    ), counts AS (
      SELECT bucket, COUNT(DISTINCT identity)::int AS "uniqueCustomers",
        COUNT(DISTINCT identity) FILTER (WHERE date_trunc(${q.granularity}, first_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade') = bucket)::int AS "newCustomers",
        COUNT(DISTINCT identity) FILTER (WHERE date_trunc(${q.granularity}, first_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade') < bucket)::int AS "returningCustomers",
        COUNT(*) FILTER (WHERE identity IS NULL)::int AS "eventsWithoutIdentity"
      FROM activity GROUP BY bucket
    ) SELECT to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS id, 'SPC' AS channel, ${q.basis} AS basis,
      "uniqueCustomers", "newCustomers", "returningCustomers", "eventsWithoutIdentity",
      'ANANAS_IDENTITY_NOT_AVAILABLE' AS "ananasCustomerCoverage"
    FROM counts WHERE to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS') > ${q.after} ORDER BY bucket LIMIT ${q.limit + 1}
  `;
}
export async function exportCustomers(q: ExportQuery) { return db.$queryRaw<{ id: string }[]>(customerSummaryQuery(q)); }
export async function exportPerformance(q: ExportQuery) {
  const now = new Date();
  const query = productPerformanceQuery(q.period, now);
  const rows = await db.$queryRaw<PerformanceInput[]>(Prisma.sql`SELECT * FROM (${query}) performance WHERE id > ${q.after} ORDER BY id LIMIT ${q.limit + 1}`);
  return rows.map(row => { const result = calculateProductPerformance(row, q.period, now); return { ...result, from: q.period.fromInput, to: q.period.toInput, salesCoverage: 'WEB_ONLY', stockCoverage: 'OWNED_WAREHOUSES', koz: result.estimatedKoz }; });
}
