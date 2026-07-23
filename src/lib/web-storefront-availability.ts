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
 * Rollout guard for DC-based automatic web availability.
 *
 * Production currently has legacy catalog data but no populated DC balances.
 * Until those balances are imported and verified, the storefront keeps honoring
 * the manual Web check without allowing an all-false auto backfill to hide the
 * complete catalog. Set ENFORCE_WEB_AUTO_AVAILABILITY=true only after the DC
 * readiness audit shows that automatic availability is trustworthy.
 */
export function isWebAutoAvailabilityEnforced() {
  return enabled(process.env.ENFORCE_WEB_AUTO_AVAILABILITY);
}

export function webStorefrontProductWhere(): Prisma.ProductWhereInput {
  return {
    isActive: true,
    availableWebManual: true,
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
