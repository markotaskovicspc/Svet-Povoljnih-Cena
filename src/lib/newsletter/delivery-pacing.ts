import "server-only";
import { Prisma } from "@prisma/client";
import { databaseIdentifier, db } from "@/lib/db";
import { BackgroundJobDeferredError } from "@/lib/background-job-deferral";
import { newsletterDeliveryPolicy } from "./delivery-policy";

// One shared lease across campaigns/workers. The 120s crash lease exceeds the
// SES client's maximum request timeout (60s); successful work leaves a cooldown.
export async function withNewsletterDeliveryPacing<T>(region: string, send: () => Promise<T>): Promise<T> {
  const key = `newsletter:ses:pacing:${region}`;
  const table = databaseIdentifier("RateLimitBucket");
  const [lease] = await db.$queryRaw<Array<{ count: number; leaseUntil: string }>>(Prisma.sql`
    INSERT INTO ${table} AS b ("key", "count", "resetAt", "updatedAt")
    VALUES (${key}, 1, NOW() + INTERVAL '120 seconds', NOW())
    ON CONFLICT ("key") DO UPDATE
      SET "count" = b."count" + 1, "resetAt" = NOW() + INTERVAL '120 seconds', "updatedAt" = NOW()
      WHERE b."resetAt" <= NOW()
    RETURNING "count", "resetAt"::text AS "leaseUntil"
  `);
  if (!lease) {
    const bucket = await db.rateLimitBucket.findUnique({ where: { key }, select: { resetAt: true } });
    throw new BackgroundJobDeferredError(bucket?.resetAt ?? new Date(Date.now() + newsletterDeliveryPolicy().intervalMs));
  }
  try {
    return await send();
  } finally {
    // Match both lease fields so an expired worker cannot release a newer lease.
    await db.$executeRaw(Prisma.sql`
      UPDATE ${table} SET "resetAt" = NOW() + ${newsletterDeliveryPolicy().intervalMs} * INTERVAL '1 millisecond', "updatedAt" = NOW()
      WHERE "key" = ${key} AND "count" = ${lease.count} AND "resetAt" = ${lease.leaseUntil}::timestamp
    `);
  }
}
