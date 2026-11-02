import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { productPerformanceQuery } from '@/lib/admin/product-performance.server';
import { calculateProductPerformance, type PerformanceInput } from '@/lib/admin/product-performance';
import { type ExportQuery } from './contract';

export function trafficQuery(q: ExportQuery) {
  const localTime = Prisma.sql`"occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade'`;
  const bucket = q.granularity === '5minute'
    ? Prisma.sql`date_trunc('hour', ${localTime}) + floor(extract(minute from ${localTime}) / 5)::int * interval '5 minutes'`
    : Prisma.sql`date_trunc(${q.granularity}, ${localTime})`;
  return Prisma.sql`
    WITH buckets AS (
      SELECT ${bucket} AS bucket,
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
export function trafficPagesQuery(q: ExportQuery) {
  const localTime = Prisma.sql`"occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Belgrade'`;
  const unit = q.granularity === 'month' ? 'month' : 'day';
  return Prisma.sql`
    WITH raw AS (
      SELECT date_trunc(${unit}, ${localTime}) AS bucket, "anonymousId", "sessionId", "productId",
        split_part(split_part(path, '#', 1), '?', 1) AS base
      FROM "AnalyticsEvent" WHERE type = 'PAGE_VIEW' AND path IS NOT NULL AND path <> ''
        AND "occurredAt" >= ${q.period.start} AND "occurredAt" < ${q.period.endExclusive}
    ), events AS (
      SELECT to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS "bucketLocal", COALESCE(NULLIF(rtrim(base, '/'), ''), '/') AS path,
        "anonymousId", "sessionId", "productId" FROM raw WHERE base <> ''
    ), pages AS (
      SELECT "bucketLocal", path, COUNT(*)::int AS "pageViews",
        COUNT(DISTINCT COALESCE("sessionId", "anonymousId"))::int AS visits, COUNT(DISTINCT "anonymousId")::int AS "uniqueVisitors"
      FROM events GROUP BY 1, 2
    ), top_product AS (
      SELECT DISTINCT ON ("bucketLocal", path) "bucketLocal", path, "productId"
      FROM events WHERE "productId" IS NOT NULL
      GROUP BY "bucketLocal", path, "productId" ORDER BY "bucketLocal", path, COUNT(*) DESC, "productId"
    ), rows AS (
      SELECT (p."bucketLocal" || '|' || p.path) COLLATE "C" AS id, p."bucketLocal", p.path, p."pageViews", p.visits, p."uniqueVisitors",
        CASE
          WHEN p.path = '/' THEN 'home'
          WHEN p.path ~ '^/p/[^/]+$' THEN 'product'
          WHEN p.path ~ '^/k/.+' THEN 'category'
          WHEN p.path = '/korpa' THEN 'cart'
          WHEN p.path = '/checkout' OR p.path LIKE '/checkout/%' THEN 'checkout'
          WHEN p.path = '/pretraga' THEN 'search'
          ELSE 'other'
        END AS "pageType",
        COALESCE(ep.id, sp.id) AS "productId", COALESCE(ep.sku, sp.sku) AS sku
      FROM pages p
      LEFT JOIN top_product t ON t."bucketLocal" = p."bucketLocal" AND t.path = p.path
      LEFT JOIN "Product" ep ON ep.id = t."productId"
      LEFT JOIN "Product" sp ON t."productId" IS NULL AND p.path ~ '^/p/[^/]+$' AND sp.slug = substr(p.path, 4)
    ) SELECT id, "bucketLocal", 'Europe/Belgrade' AS timezone, path, "pageType", "pageViews", visits, "uniqueVisitors", "productId", sku
    FROM rows WHERE id > ${q.after} ORDER BY id LIMIT ${q.limit + 1}
  `;
}
export async function exportTrafficPages(q: ExportQuery) {
  return db.$queryRaw<{ id: string }[]>(trafficPagesQuery(q));
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
