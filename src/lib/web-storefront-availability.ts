import "server-only";

import type { Prisma } from "@prisma/client";

type WebAvailabilityProduct = {
  isActive: boolean;
  availableWebManual: boolean;
  availableWebAuto: boolean;
};

function enabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

/**
 * Rollout guard for automatic web availability.
 *
 * Production currently has legacy catalog data but no populated DC balances.
 * Until those balances are imported and verified, the storefront keeps honoring
 * the manual Web check without allowing an all-false auto backfill to hide the
 * complete catalog. The approved business default counts audited DC stock and
 * fresh, approved Rabalux stock (with its safety buffer), but this guard must
 * stay off until the DC import/audit is complete and the client confirms that
 * supplier stock should participate. Set ENFORCE_WEB_AUTO_AVAILABILITY=true
 * only when that combined automatic availability is trustworthy.
 */
export function isWebAutoAvailabilityEnforced() {
  return enabled(process.env.ENFORCE_WEB_AUTO_AVAILABILITY);
}

export function webStorefrontProductWhere(): Prisma.ProductWhereInput {
  const now = new Date();
  return {
    isActive: true,
    availableWebManual: true,
    priceListEntries: {
      some: {
        price: { gt: 0 },
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gte: now } }],
        priceList: {
          is: {
            kind: "RETAIL",
            active: true,
            AND: [
              { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
              { OR: [{ validTo: null }, { validTo: { gte: now } }] },
            ],
          },
        },
      },
    },
    ...(isWebAutoAvailabilityEnforced() ? { availableWebAuto: true } : {}),
  };
}

export function isProductAvailableOnWeb(product: WebAvailabilityProduct) {
  return (
    product.isActive &&
    product.availableWebManual &&
    (!isWebAutoAvailabilityEnforced() || product.availableWebAuto)
  );
}
