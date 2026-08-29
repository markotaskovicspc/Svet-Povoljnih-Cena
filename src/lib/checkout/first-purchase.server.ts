import "server-only";

import { db } from "@/lib/db";

/**
 * The first-purchase benefit is consumed only after an issued SALE receipt.
 * Keep checkout presentation and authoritative order pricing on one rule.
 */
export async function isFirstPurchaseDiscountEligible(
  userId: string | null | undefined,
) {
  if (!userId) return false;

  const issuedSale = await db.order.findFirst({
    where: {
      userId,
      fiscalDocuments: {
        some: { kind: "SALE", status: "ISSUED" },
      },
    },
    select: { id: true },
  });

  return issuedSale == null;
}
