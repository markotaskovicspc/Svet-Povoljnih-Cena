import "server-only";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Phase 4E — Audience builder.
 *
 * The admin UI persists a `ViberAudienceQuery.filter` JSON blob; this
 * module is the single source of truth for what that JSON may contain
 * and how it is resolved into a list of `(userId, phone, displayName)`
 * recipients at send time.
 *
 * Filter dimensions (per spec §4E-2):
 *   - cities: ship-to cities of the customer's last order. ANY-of match.
 *   - lastPurchaseFrom / lastPurchaseTo: ISO date window over the most
 *     recent ISPORUCENO order. Either bound is optional.
 *   - includeNonCustomers: also include users without orders (default
 *     false) — useful for newsletter-style announcements.
 *
 * Compliance: only users with `MarketingConsent.viber === true` AND a
 * non-null `phone` are returned. We never broadcast without consent.
 */

export const audienceFilterSchema = z
  .object({
    cities: z.array(z.string().min(1)).max(50).optional(),
    lastPurchaseFrom: z.string().datetime().optional(),
    lastPurchaseTo: z.string().datetime().optional(),
    includeNonCustomers: z.boolean().optional(),
  })
  .strict();

export type AudienceFilter = z.infer<typeof audienceFilterSchema>;

export interface AudienceRecipient {
  userId: string;
  phone: string;
  displayName: string;
  /** City of the last order, if any (used for personalisation/QA). */
  lastCity: string | null;
}

/**
 * Coerce arbitrary JSON (Prisma `Json` column) into a validated filter.
 * Throws `ZodError` on invalid input so callers can surface the problem
 * to the admin form.
 */
export function parseAudienceFilter(input: unknown): AudienceFilter {
  return audienceFilterSchema.parse(input ?? {});
}

/**
 * Resolve a filter to a deduplicated recipient list.
 *
 * Implementation strategy:
 *   1. Find the latest ISPORUCENO order per user (within date window) and
 *      project city + userId.
 *   2. Intersect with users who have viber consent + a phone.
 *   3. Optionally union with non-customers (consent + phone, no orders).
 */
export async function resolveAudience(
  filter: AudienceFilter,
): Promise<AudienceRecipient[]> {
  const cityFilter = filter.cities?.length
    ? Prisma.sql`AND o."shipCity" = ANY(${filter.cities}::text[])`
    : Prisma.empty;
  const fromFilter = filter.lastPurchaseFrom
    ? Prisma.sql`AND o."createdAt" >= ${new Date(filter.lastPurchaseFrom)}`
    : Prisma.empty;
  const toFilter = filter.lastPurchaseTo
    ? Prisma.sql`AND o."createdAt" <= ${new Date(filter.lastPurchaseTo)}`
    : Prisma.empty;

  // DISTINCT ON (userId) ordered by createdAt DESC → latest order per user.
  const rows = await db.$queryRaw<
    Array<{
      userId: string;
      phone: string;
      firstName: string | null;
      lastName: string | null;
      lastCity: string | null;
    }>
  >(Prisma.sql`
    SELECT DISTINCT ON (o."userId")
      o."userId"     AS "userId",
      u."phone"      AS "phone",
      u."firstName"  AS "firstName",
      u."lastName"   AS "lastName",
      o."shipCity"   AS "lastCity"
    FROM "Order" o
    JOIN "User" u ON u."id" = o."userId"
    JOIN "MarketingConsent" mc ON mc."userId" = u."id"
    WHERE o."userId" IS NOT NULL
      AND o."status" = 'ISPORUCENO'
      AND mc."viber" = true
      AND u."phone" IS NOT NULL
      AND u."deletedAt" IS NULL
      ${cityFilter}
      ${fromFilter}
      ${toFilter}
    ORDER BY o."userId", o."createdAt" DESC
  `);

  const recipients: AudienceRecipient[] = rows.map((r) => ({
    userId: r.userId,
    phone: r.phone,
    displayName:
      [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || "Korisnik",
    lastCity: r.lastCity,
  }));

  if (filter.includeNonCustomers) {
    // Add users with consent + phone who have no qualifying order.
    const seen = new Set(recipients.map((r) => r.userId));
    const extras = await db.user.findMany({
      where: {
        deletedAt: null,
        phone: { not: null },
        marketingConsent: { is: { viber: true } },
        id: { notIn: recipients.length ? Array.from(seen) : ["__none__"] },
      },
      select: {
        id: true,
        phone: true,
        firstName: true,
        lastName: true,
      },
    });
    for (const u of extras) {
      if (!u.phone) continue;
      recipients.push({
        userId: u.id,
        phone: u.phone,
        displayName:
          [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
          "Korisnik",
        lastCity: null,
      });
    }
  }

  return recipients;
}

/** Cheap count for the admin "preview audience" badge. */
export async function countAudience(filter: AudienceFilter): Promise<number> {
  const recipients = await resolveAudience(filter);
  return recipients.length;
}
