import "server-only";

import { db } from "@/lib/db";

/**
 * The first-purchase benefit is consumed only after an issued SALE receipt.
 * Keep checkout presentation and authoritative order pricing on one rule.
 */
export async function isFirstPurchaseDiscountEligible(
  userId: string | null | undefined,
  verifiedEmail?: string | null,
) {
  if (!userId && !verifiedEmail) return false;

  // Use one identity across guest and account purchases. This does not sign
  // a guest in, even when the confirmed email belongs to an existing account.
  const email = verifiedEmail?.trim().toLowerCase() || (userId
    ? (await db.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email
    : null);

  const issuedSale = await db.order.findFirst({
    where: {
      OR: [
        ...(userId ? [{ userId }] : []),
        ...(email ? [
          { guestEmail: { equals: email, mode: "insensitive" as const } },
          { user: { email: { equals: email, mode: "insensitive" as const } } },
        ] : []),
      ],
      fiscalDocuments: {
        some: { kind: "SALE", status: "ISSUED" },
      },
    },
    select: { id: true },
  });

  return issuedSale == null;
}
