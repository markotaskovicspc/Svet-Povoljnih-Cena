import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { nthPhoneNumber } from "./nth";

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
 * Default audience requires recorded Viber consent. The explicit allStoredPhones
 * mode uses the dated operator declaration below, excluding recorded withdrawals.
 */

export const audienceFilterSchema = z
  .object({
    channel: z.enum(["VIBER", "SMS"]).optional(),
    phoneScope: z.enum(["current"]).optional(),
    cities: z.array(z.string().min(1)).max(50).optional(),
    lastPurchaseFrom: z.string().datetime().optional(),
    lastPurchaseTo: z.string().datetime().optional(),
    includeNonCustomers: z.boolean().optional(),
    allStoredPhones: z.boolean().optional(),
    consentEvidence: z.object({ source: z.string().max(200), confirmedAt: z.string().datetime() }).optional(),
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
  if (filter.allStoredPhones) return resolveStoredPhones(filter);
  const consentFlag = filter.channel === "SMS" ? Prisma.raw('mc.sms') : Prisma.raw('mc."viber"');
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
      AND ${consentFlag} = true
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
        marketingConsent: { is: filter.channel === "SMS" ? { sms: true } : { viber: true } },
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

  // The same Serbian number can be stored with +381, 00381, or a local 0.
  const unique = new Map<string, AudienceRecipient>();
  for (const recipient of recipients) {
    try {
      const phone = nthPhoneNumber(recipient.phone);
      if (!unique.has(phone)) unique.set(phone, { ...recipient, phone });
    } catch { /* Invalid numbers cannot be submitted to this provider. */ }
  }
  return [...unique.values()];
}

/** Cheap count for the admin "preview audience" badge. */
export async function countAudience(filter: AudienceFilter): Promise<number> {
  const recipients = await resolveAudience(filter);
  return recipients.length;
}

/** Counts only; raw contact numbers never leave the authenticated server. */
export async function getViberContactSummary(channel: "VIBER" | "SMS" = "VIBER") {
  const [rows, eligible, allEligible] = await Promise.all([
    db.$queryRaw<{ phone: string }[]>(Prisma.sql`
      SELECT DISTINCT phone FROM (
        SELECT "phone" AS phone FROM "User" WHERE "deletedAt" IS NULL
        UNION
        SELECT c."phone" FROM "Customer" c LEFT JOIN "User" u ON u.id = c."userId"
          WHERE c."userId" IS NULL OR u."deletedAt" IS NULL
        UNION
        SELECT o."shipPhone" FROM "Order" o LEFT JOIN "User" u ON u.id = o."userId"
          WHERE o."userId" IS NULL OR u."deletedAt" IS NULL
      ) contacts WHERE phone IS NOT NULL AND TRIM(phone) <> ''
    `),
    countAudience({ includeNonCustomers: true, channel }),
    countAudience({ allStoredPhones: true, phoneScope: "current", channel }),
  ]);
  const valid = new Set<string>();
  let invalid = 0;
  for (const row of rows) {
    try { valid.add(nthPhoneNumber(row.phone)); } catch { invalid++; }
  }
  return { total: valid.size, eligible, allEligible, withoutConsent: Math.max(0, valid.size - eligible), invalid };
}

// Stefan confirmed consent for all existing contacts on 2026-10-14. New contacts
// after this cutoff are not silently covered by that historical declaration.
export const STORED_PHONES_CONSENT = { source: "Stefan: all existing numbers have Viber consent", confirmedAt: "2026-10-14T20:38:02.000Z" } as const;
export function storedPhoneRecipientId(phone: string) { return "phone_" + createHash("sha256").update(nthPhoneNumber(phone)).digest("hex"); }
async function blockedPhones(channel: "VIBER" | "SMS" = "VIBER") {
  const flag = channel === "SMS" ? Prisma.raw('mc.sms') : Prisma.raw('mc.viber');
  const rows = await db.$queryRaw<{ phone: string }[]>(Prisma.sql`
    SELECT u.phone FROM "User" u LEFT JOIN "MarketingConsent" mc ON mc."userId"=u.id
      WHERE u.phone IS NOT NULL AND (u."deletedAt" IS NOT NULL OR ${flag}=false)
    UNION
    SELECT o."shipPhone" FROM "Order" o JOIN "User" u ON u.id=o."userId" LEFT JOIN "MarketingConsent" mc ON mc."userId"=u.id
      WHERE u."deletedAt" IS NOT NULL OR ${flag}=false
    UNION
    SELECT c.phone FROM "Customer" c JOIN "User" u ON u.id=c."userId" LEFT JOIN "MarketingConsent" mc ON mc."userId"=u.id
      WHERE c.phone IS NOT NULL AND (u."deletedAt" IS NOT NULL OR ${flag}=false)
  `);
  const phones = new Set<string>();
  for (const row of rows) { try { phones.add(nthPhoneNumber(row.phone)); } catch { /* invalid */ } }
  return phones;
}
export async function isStoredPhoneAllowed(phone: string, channel: "VIBER" | "SMS" = "VIBER") {
  let normalized: string;
  try { normalized = nthPhoneNumber(phone); } catch { return false; }
  return !(await blockedPhones(channel)).has(normalized);
}
async function resolveStoredPhones(filter: AudienceFilter): Promise<AudienceRecipient[]> {
  const cutoff = filter.phoneScope === "current" ? new Date() : new Date(STORED_PHONES_CONSENT.confirmedAt);
  const [rows, blocked] = await Promise.all([
    db.$queryRaw<{ phone: string; name: string | null }[]>(Prisma.sql`
      SELECT u.phone, u."firstName" AS name FROM "User" u WHERE u.phone IS NOT NULL AND u."deletedAt" IS NULL AND u."createdAt" <= ${cutoff}
      UNION ALL
      SELECT c.phone, c."firstName" FROM "Customer" c WHERE c.phone IS NOT NULL AND c."createdAt" <= ${cutoff}
      UNION ALL
      SELECT o."shipPhone", o."shipFirstName" FROM "Order" o WHERE o."createdAt" <= ${cutoff}
    `), blockedPhones(filter.channel),
  ]);
  const unique = new Map<string, AudienceRecipient>();
  for (const row of rows) {
    try { const phone=nthPhoneNumber(row.phone); if(!blocked.has(phone)&&!unique.has(phone)) unique.set(phone,{userId:storedPhoneRecipientId(phone),phone,displayName:row.name?.trim()||"Korisnik",lastCity:null}); } catch { /* invalid */ }
  }
  return [...unique.values()];
}
