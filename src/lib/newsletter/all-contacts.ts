import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { databaseIdentifier, db } from "@/lib/db";

// An address in commerce data is not a subscription. Only add missing records
// as PENDING; never overwrite consent, withdrawal, suppression or profile data.
export async function syncAllNewsletterContacts() {
  const rows = await db.$queryRaw<Array<{ email: string }>>(Prisma.sql`
    WITH sources AS (
      SELECT "email" FROM ${databaseIdentifier("User")} WHERE "deletedAt" IS NULL
      UNION SELECT "email" FROM ${databaseIdentifier("Customer")}
      UNION SELECT "guestEmail" FROM ${databaseIdentifier("Order")}
      UNION SELECT "guestEmail" FROM ${databaseIdentifier("CheckoutSession")}
      UNION SELECT "email" FROM ${databaseIdentifier("NewsletterSubscriber")}
    ), contacts AS (
      SELECT DISTINCT lower(btrim("email")) AS email FROM sources
      WHERE NULLIF(btrim("email"), '') IS NOT NULL
    )
    SELECT c.email FROM contacts c
    WHERE NOT EXISTS (SELECT 1 FROM ${databaseIdentifier("MarketingContact")} m WHERE lower(btrim(m."email")) = c.email)
      AND NOT EXISTS (SELECT 1 FROM ${databaseIdentifier("EmailSuppression")} s WHERE lower(btrim(s."email")) = c.email)
      AND NOT EXISTS (SELECT 1 FROM ${databaseIdentifier("NewsletterSubscriber")} n WHERE lower(btrim(n."email")) = c.email AND n."unsubscribedAt" IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM ${databaseIdentifier("User")} u WHERE lower(btrim(u."email")) = c.email AND u."deletedAt" IS NOT NULL)
    ORDER BY c.email LIMIT 250001
  `);
  if (rows.length > 250_000) throw new Error("Više od 250.000 novih kontakata; potreban je zaseban uvoz.");
  const emails = [...new Set(rows.map((row) => row.email.trim().toLowerCase()))].filter((email) => z.email().safeParse(email).success);
  let added = 0;
  for (let offset = 0; offset < emails.length; offset += 2_000) {
    const result = await db.marketingContact.createMany({
      data: emails.slice(offset, offset + 2_000).map((email) => ({ email, status: "PENDING" as const, source: "all-contacts", subscribedAt: null, confirmedAt: null })),
      skipDuplicates: true,
    });
    added += result.count;
  }
  return { added };
}
