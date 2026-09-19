import "server-only";

import { Prisma } from "@prisma/client";
import { databaseIdentifier, db } from "@/lib/db";

export type NewsletterContactOverview = {
  total: number;
  activeConsent: number;
  withoutActiveConsent: number;
  eligible: number;
  legacyConsentMissingContact: number;
};

// Aggregate in PostgreSQL: no contact limit, no email addresses returned to the UI,
// and no copying customers into marketing lists or granting consent.
export function newsletterContactOverviewQuery() {
  return Prisma.sql`
    WITH sources AS (
      SELECT u."email", COALESCE(mc."email", false) AND u."emailVerified" IS NOT NULL AS legacy_consent
      FROM ${databaseIdentifier("User")} u
      LEFT JOIN ${databaseIdentifier("MarketingConsent")} mc ON mc."userId" = u."id"
      WHERE u."deletedAt" IS NULL
      UNION ALL SELECT "email", false FROM ${databaseIdentifier("Customer")}
      UNION ALL SELECT "guestEmail", false FROM ${databaseIdentifier("Order")}
      UNION ALL SELECT "guestEmail", false FROM ${databaseIdentifier("CheckoutSession")}
      UNION ALL SELECT "email", "consent" AND "unsubscribedAt" IS NULL
        FROM ${databaseIdentifier("NewsletterSubscriber")}
      UNION ALL SELECT "email", false FROM ${databaseIdentifier("MarketingContact")}
    ), contacts AS (
      SELECT lower(btrim("email")) AS email, bool_or(legacy_consent) AS legacy_consent
      FROM sources WHERE NULLIF(btrim("email"), '') IS NOT NULL
      GROUP BY lower(btrim("email"))
    ), marketing AS (
      SELECT lower(btrim("email")) AS email,
        bool_or("status" = 'ACTIVE' AND "subscribedAt" IS NOT NULL) AS active_consent
      FROM ${databaseIdentifier("MarketingContact")}
      GROUP BY lower(btrim("email"))
    ), suppressed AS (
      SELECT DISTINCT lower(btrim("email")) AS email
      FROM ${databaseIdentifier("EmailSuppression")}
    )
    SELECT count(*)::bigint AS total,
      count(*) FILTER (WHERE m.active_consent)::bigint AS "activeConsent",
      count(*) FILTER (WHERE m.active_consent AND s.email IS NULL)::bigint AS eligible,
      count(*) FILTER (WHERE c.legacy_consent AND m.email IS NULL AND s.email IS NULL)::bigint
        AS "legacyConsentMissingContact"
    FROM contacts c
    LEFT JOIN marketing m ON m.email = c.email
    LEFT JOIN suppressed s ON s.email = c.email
  `;
}

export async function getNewsletterContactOverview(): Promise<NewsletterContactOverview> {
  const [row] = await db.$queryRaw<Array<{
    total: bigint;
    activeConsent: bigint;
    eligible: bigint;
    legacyConsentMissingContact: bigint;
  }>>(newsletterContactOverviewQuery());
  const total = Number(row.total);
  const activeConsent = Number(row.activeConsent);
  return {
    total,
    activeConsent,
    withoutActiveConsent: total - activeConsent,
    eligible: Number(row.eligible),
    legacyConsentMissingContact: Number(row.legacyConsentMissingContact),
  };
}
